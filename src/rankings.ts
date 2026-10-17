import type { Round, Speaker, Team } from "./domain";
import type { RoundScorecard, SpeakerPosition } from "./scoring";
export interface TeamRankingRow { teamId:string; teamName:string; wins:number; losses:number; itemTotal:number; debates:number; rank:number }
export interface SpeakerRankingRow { speakerId:string; speakerName:string; teamId:string; teamName:string; itemTotal:number; evaluations:number; rank:number }
export const SPEAKER_RANKINGS:Array<{key:SpeakerPosition|"all";title:string}>=[
 {key:"all",title:"Mejor orador"},{key:"introductor",title:"Mejor introductor"},
 {key:"first_rebuttal",title:"Mejor 1.er refutador"},{key:"second_rebuttal",title:"Mejor 2.º refutador"},{key:"concluder",title:"Mejor conclusor"}];
function isQualifying(card:RoundScorecard,rounds:Round[]):boolean { const round=rounds.find(x=>x.id===card.roundId); return Boolean(round&&(round.scoreType??"qualifying")==="qualifying"&&card.teams?.length===2); }
export function buildTeamRanking(teams:Team[],rounds:Round[],scorecards:RoundScorecard[]):TeamRankingRow[]{
 const totals=new Map<string,{teamId:string;wins:number;losses:number;itemTotal:number;debates:number}>();
 for(const team of teams.filter(x=>x.active)) totals.set(team.id,{teamId:team.id,wins:0,losses:0,itemTotal:0,debates:0});
 for(const card of scorecards.filter(x=>isQualifying(x,rounds))){
  const [aScore,bScore]=card.teams;if(!aScore||!bScore||aScore.teamId===bScore.teamId)continue;
  const a=totals.get(aScore.teamId),b=totals.get(bScore.teamId);
  if(!a||!b||!Number.isFinite(aScore.total)||!Number.isFinite(bScore.total))continue;
  a.itemTotal+=aScore.total;b.itemTotal+=bScore.total;a.debates++;b.debates++;
  if(aScore.total>bScore.total){a.wins++;b.losses++;}else if(bScore.total>aScore.total){b.wins++;a.losses++;}
 }
 const sorted=[...totals.values()].map(row=>({...row,teamName:teams.find(t=>t.id===row.teamId)?.name??row.teamId}))
 .sort((a,b)=>b.wins-a.wins||b.itemTotal-a.itemTotal||a.teamName.localeCompare(b.teamName,"es"));
 let previousWins:number|undefined,previousTotal:number|undefined,rank=0;
 return sorted.map((row,index)=>{if(previousWins===undefined||row.wins!==previousWins||row.itemTotal!==previousTotal)rank=index+1;previousWins=row.wins;previousTotal=row.itemTotal;return {...row,rank};});
}
export function buildSpeakerRankings(teams:Team[],speakers:Speaker[],rounds:Round[],scorecards:RoundScorecard[]){
 const teamNames=new Map(teams.map(t=>[t.id,t.name])),speakerNames=new Map(speakers.map(s=>[s.id,s.name]));
 const qualifying=scorecards.filter(card=>isQualifying(card,rounds));
 return SPEAKER_RANKINGS.map(category=>{
  const sums=new Map<string,{speakerId:string;speakerName:string;teamId:string;itemTotal:number;evaluations:number}>();
  for(const card of qualifying)for(const item of card.speakers??[]){
   if(category.key!=="all"&&item.position!==category.key)continue;
   if(!Number.isFinite(item.score)||!speakerNames.has(item.speakerId))continue;
   const row=sums.get(item.speakerId)??{speakerId:item.speakerId,speakerName:item.speakerName||speakerNames.get(item.speakerId)||item.speakerId,teamId:item.teamId,itemTotal:0,evaluations:0};
   row.itemTotal+=item.score;row.evaluations++;sums.set(item.speakerId,row);
  }
  const sorted=[...sums.values()].map(row=>({...row,teamName:teamNames.get(row.teamId)??"Equipo desconocido"})).sort((a,b)=>b.itemTotal-a.itemTotal||a.speakerName.localeCompare(b.speakerName,"es"));
  let previous:number|undefined,rank=0;
  const rows=sorted.map((row,index)=>{if(previous===undefined||row.itemTotal!==previous)rank=index+1;previous=row.itemTotal;return {...row,rank};});
  return {...category,rows:rows as SpeakerRankingRow[]};
 });
}
