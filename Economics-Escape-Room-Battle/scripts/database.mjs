import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export function database(file=':memory:'){
 const sql=new DatabaseSync(file);sql.exec('PRAGMA foreign_keys = ON');
 if(!sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rooms'").get())sql.exec(readFileSync(new URL('../drizzle/0000_classrooms.sql',import.meta.url),'utf8'));
 if(!sql.prepare('PRAGMA table_info(rooms)').all().some(c=>c.name==='question_set'))sql.exec(readFileSync(new URL('../drizzle/0001_question_set.sql',import.meta.url),'utf8'));
 if(!sql.prepare('PRAGMA table_info(rooms)').all().some(c=>c.name==='phase'))sql.exec(readFileSync(new URL('../drizzle/0002_live_rounds.sql',import.meta.url),'utf8'));
 const prepare=(query,params=[])=>({bind(...values){return prepare(query,values);},async first(){return sql.prepare(query).get(...params)||null;},async all(){return {results:sql.prepare(query).all(...params)};},async run(){const r=sql.prepare(query).run(...params);return {meta:{changes:Number(r.changes)}};}});
 return {prepare,async batch(items){sql.exec('BEGIN');try{const result=[];for(const item of items)result.push(await item.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}},close(){sql.close();}};
}
