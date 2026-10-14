import type { Tournament } from "./domain";
export type AssignmentConflict = { type: "institution" | "team-judge" | "judge-judge"; roomId: string; roomName: string; teamIds: string[]; judgeIds: string[]; message: string };
export function findAssignmentConflicts(tournament: Pick<Tournament, "teams" | "judges" | "rooms">): AssignmentConflict[] {
  const conflicts: AssignmentConflict[] = [];
  for (const room of tournament.rooms) {
    const teams = [room.teamFavorId, room.teamContraId].filter(Boolean).map((id) => tournament.teams.find((team) => team.id === id)).filter((team): team is Tournament["teams"][number] => Boolean(team));
    const judges = (room.judgeIds ?? []).map((id) => tournament.judges.find((judge) => judge.id === id)).filter((judge): judge is Tournament["judges"][number] => Boolean(judge));
    for (const judge of judges) for (const team of teams) {
      const ji = judge.institution?.trim().toLocaleLowerCase("es-ES") ?? "";
      const ti = team.institution?.trim().toLocaleLowerCase("es-ES") ?? "";
      if (ji && ti && ji === ti) conflicts.push({ type:"institution", roomId:room.id, roomName:room.name, teamIds:[team.id], judgeIds:[judge.id], message:judge.name+" y "+team.name+" comparten institución." });
      if (team.incompatibleJudgeIds?.includes(judge.id)) conflicts.push({ type:"team-judge", roomId:room.id, roomName:room.name, teamIds:[team.id], judgeIds:[judge.id], message:judge.name+" es incompatible con el equipo "+team.name+"." });
    }
    for (let i=0;i<judges.length;i++) for (let j=i+1;j<judges.length;j++) {
      const a=judges[i], b=judges[j];
      if (a.incompatibleJudgeIds?.includes(b.id)||b.incompatibleJudgeIds?.includes(a.id)) conflicts.push({ type:"judge-judge", roomId:room.id, roomName:room.name, teamIds:[], judgeIds:[a.id,b.id], message:a.name+" y "+b.name+" son incompatibles." });
    }
  }
  return conflicts;
}
export function setJudgeIncompatibility(judges:Tournament["judges"], judgeId:string, incompatibleId:string, incompatible:boolean):Tournament["judges"] {
  if (judgeId===incompatibleId) throw new Error("Un juez no puede ser incompatible consigo mismo.");
  if (!judges.some(j=>j.id===judgeId)||!judges.some(j=>j.id===incompatibleId)) throw new Error("No se encuentra alguno de los jueces seleccionados.");
  return judges.map(j=> {
    if(j.id!==judgeId&&j.id!==incompatibleId)return {...j,incompatibleJudgeIds:[...new Set(j.incompatibleJudgeIds??[])]};
    const otherId=j.id===judgeId?incompatibleId:judgeId, ids=new Set(j.incompatibleJudgeIds??[]);
    if(incompatible)ids.add(otherId);else ids.delete(otherId);
    return {...j,incompatibleJudgeIds:[...ids].sort()};
  });
}
