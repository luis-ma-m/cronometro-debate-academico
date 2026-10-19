import { Client } from "@neondatabase/serverless";

const connectionString = (process.env.NEON_DATABASE_URL || process.env.DATABASE_URL)?.trim();
if (!connectionString) throw new Error("Falta NEON_DATABASE_URL (o DATABASE_URL).");
const phases = [
  ["ledu-01","Exposición inicial","favor","Equipo a favor",240,"opening",[60,30,10]],
  ["ledu-02","Examen cruzado","contra","En contra pregunta a A favor",120,"cross-examination",[30,10]],
  ["ledu-03","Exposición inicial","contra","Equipo en contra",240,"opening",[60,30,10]],
  ["ledu-04","Examen cruzado","favor","A favor pregunta a En contra",120,"cross-examination",[30,10]],
  ["ledu-05","Refutación 1","favor","Equipo a favor",300,"rebuttal",[60,30,10]],
  ["ledu-06","Refutación 1","contra","Equipo en contra",300,"rebuttal",[60,30,10]],
  ["ledu-07","Refutación 2","favor","Equipo a favor",300,"rebuttal",[60,30,10]],
  ["ledu-08","Refutación 2","contra","Equipo en contra",300,"rebuttal",[60,30,10]],
  ["ledu-09","Refutación cruzada","favor","Equipo a favor",90,"cross-rebuttal",[30,10]],
  ["ledu-10","Refutación cruzada","contra","Equipo en contra",90,"cross-rebuttal",[30,10]],
  ["ledu-11","Conclusión","contra","Equipo en contra",180,"conclusion",[60,30,10]],
  ["ledu-12","Conclusión","favor","Equipo a favor",180,"conclusion",[60,30,10]]
];
const client = new Client(connectionString);
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('ledu-seed'))");
  await client.query("INSERT INTO tournament_settings (id, tournament_name) VALUES (1, 'Torneo LEDU') ON CONFLICT (id) DO NOTHING");
  await client.query("INSERT INTO format_presets (id, name, version) VALUES ('format-ledu','LEDU',1) ON CONFLICT (id) DO NOTHING");
  for (let i = 0; i < phases.length; i += 1) {
    const phase = phases[i];
    await client.query(
      `INSERT INTO format_phases(format_id,id,phase_order,name,side,speaker,duration_seconds,phase_type,warning_thresholds_seconds,allow_overtime_display)
       VALUES ('format-ledu',$1,$2,$3,$4,$5,$6,$7,$8,true)
       ON CONFLICT (format_id,id) DO NOTHING`,
      [phase[0], i, phase[1], phase[2], phase[3], phase[4], phase[5], phase[6]],
    );
  }
  await client.query("INSERT INTO rounds (id,number,name,is_active,score_type,default_format_id) VALUES ('round-1',1,'Ronda 1',false,'qualifying','format-ledu') ON CONFLICT (id) DO NOTHING");
  const settings = await client.query("SELECT active_round_id FROM tournament_settings WHERE id=1");
  if (!settings.rows[0]?.active_round_id) {
    const activeRound = await client.query("SELECT id FROM rounds WHERE is_active=true LIMIT 1");
    const activeRoundId = activeRound.rows[0]?.id || "round-1";
    await client.query("UPDATE rounds SET is_active=false WHERE is_active=true");
    await client.query("UPDATE rounds SET is_active=true WHERE id=$1", [activeRoundId]);
    await client.query("UPDATE tournament_settings SET active_round_id=$1 WHERE id=1", [activeRoundId]);
  }
  await client.query("INSERT INTO score_categories (id,name,category_order) VALUES ('form','Forma',0),('evidence','Evidencias',1),('rebuttal','Refutaciones',2) ON CONFLICT (id) DO NOTHING");
  await client.query("COMMIT");
  console.log("Seed LEDU ejecutado de forma idempotente; no se eliminaron datos.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error(error instanceof Error ? error.message : "No se pudo inicializar el estado LEDU.");
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
