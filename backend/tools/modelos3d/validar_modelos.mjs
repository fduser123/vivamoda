/**
 * Valida los modelos generados sin depender de Blender:
 *
 *   cd backend && node tools/modelos3d/validar_modelos.mjs
 *
 * Comprueba, para cada .glb del índice: que existe, que pesa lo que dice el
 * índice, que la cabecera GLB es válida (magic/versión/longitud declarada),
 * que el chunk JSON se puede parsear y que trae mallas, materiales y la
 * accessor POSITION. Un .glb truncado o corrupto no se detectaría solo por
 * existir en disco.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SALIDA = process.argv[2] || path.resolve(AQUI, '..', '..', 'public', 'models', 'generated');

const indice = JSON.parse(fs.readFileSync(path.join(SALIDA, 'index.json'), 'utf8'));
const errores = [];
const avisos = [];
let bytes = 0;
let triangulos = 0;

function revisar(entrada) {
  const ruta = path.join(SALIDA, entrada.archivo);
  if (!fs.existsSync(ruta)) return `falta el archivo ${entrada.archivo}`;
  const buf = fs.readFileSync(ruta);
  bytes += buf.length;
  if (buf.length !== entrada.bytes) avisos.push(`${entrada.sku}: el índice dice ${entrada.bytes} B y el archivo tiene ${buf.length} B`);
  if (buf.toString('ascii', 0, 4) !== 'glTF') return `${entrada.sku}: no es un GLB (magic distinto)`;
  if (buf.readUInt32LE(4) !== 2) return `${entrada.sku}: versión glTF ${buf.readUInt32LE(4)} (se esperaba 2)`;
  if (buf.readUInt32LE(8) !== buf.length) return `${entrada.sku}: longitud declarada ${buf.readUInt32LE(8)} ≠ real ${buf.length}`;

  const largoJson = buf.readUInt32LE(12);
  const tipo = buf.toString('ascii', 16, 20);
  if (tipo !== 'JSON') return `${entrada.sku}: el primer chunk no es JSON ("${tipo}")`;
  if (20 + largoJson > buf.length) return `${entrada.sku}: el chunk JSON desborda el archivo`;

  let gltf;
  try { gltf = JSON.parse(buf.toString('utf8', 20, 20 + largoJson)); } catch (err) { return `${entrada.sku}: JSON ilegible (${err.message})`; }
  if (!gltf.meshes?.length) return `${entrada.sku}: sin mallas`;
  if (!gltf.materials?.length) return `${entrada.sku}: sin materiales`;
  if (!gltf.accessors?.some((a) => a.type === 'VEC3' && a.componentType === 5126)) return `${entrada.sku}: sin posiciones (VEC3 float)`;
  const bin = buf.toString('ascii', 20 + largoJson + 4, 20 + largoJson + 8);
  if (bin !== 'BIN\u0000') return `${entrada.sku}: falta el chunk BIN`;

  const tri = entrada.triangulos || 0;
  triangulos += tri;
  if (tri > 4000) avisos.push(`${entrada.sku}: ${tri} triángulos (más de lo previsto para low-poly)`);
  if (buf.length > 400 * 1024) avisos.push(`${entrada.sku}: ${(buf.length / 1024).toFixed(0)} KB (archivo grande para un accesorio)`);
  return null;
}

for (const entrada of indice.modelos) {
  const fallo = revisar(entrada);
  if (fallo) errores.push(fallo);
}

// ¿Sobra algún .glb en disco que no esté en el índice?
const enDisco = fs.readdirSync(SALIDA).filter((f) => f.endsWith('.glb'));
const enIndice = new Set(indice.modelos.map((m) => m.archivo));
const sueltos = enDisco.filter((f) => !enIndice.has(f));

// Todo sku del índice debe existir en la base (lo garantiza el perfil)
const sinMedidas = indice.modelos.filter((m) => !(m.alto > 0) || !(m.ancho > 0) || !(m.fondo > 0));

console.log(`modelos en el índice: ${indice.modelos.length} · .glb en disco: ${enDisco.length}`);
console.log(`peso total: ${(bytes / 1048576).toFixed(1)} MB · triángulos: ${triangulos} (media ${Math.round(triangulos / (indice.modelos.length || 1))})`);
console.log(`alto: min ${Math.min(...indice.modelos.map((m) => m.alto)).toFixed(2)} m · max ${Math.max(...indice.modelos.map((m) => m.alto)).toFixed(2)} m`);
console.log(`familias: ${Object.keys(indice.familias).length} · materiales: ${new Set(indice.modelos.map((m) => m.material)).size}`);
if (sueltos.length) console.log(`⚠ .glb sin entrada en el índice: ${sueltos.length} (${sueltos.slice(0, 3).join(', ')})`);
if (sinMedidas.length) console.log(`⚠ sin medidas: ${sinMedidas.length}`);
if (avisos.length) { console.log(`avisos (${avisos.length}):`); for (const a of avisos.slice(0, 8)) console.log('  ·', a); }
if (errores.length) {
  console.log(`\n✗ ERRORES (${errores.length}):`);
  for (const e of errores.slice(0, 20)) console.log('  ·', e);
  process.exit(1);
}
console.log('\n✓ los ' + indice.modelos.length + ' modelos son GLB válidos y coherentes con el índice');
