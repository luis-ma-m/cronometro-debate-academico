import {describe,expect,it} from "vitest";
import {buildSpeakerRankings,buildTeamRanking} from "./rankings";
import type {Round} from "./domain";
import type {RoundScorecard} from "./scoring";
const rounds:Round[]=[{id:"q",number:1,name:"Q",active:false,defaultFormatId:"f",scoreType:"qualifying"},{id:"e",number:2,name:"E",active:false,defaultFormatId:"f",scoreType:"elimination"}];
const teams=[{id:"a",name:"A",institution:"",active:true,incompatibleJudgeIds:[]},{id:"b",name:"B",institution:"",active:true,incompatibleJudgeIds:[]},{id:"c",name:"C",institution:"",active:true,incompatibleJudgeIds:[]}];
const speakers=[{id:"s1",teamId:"a",name:"Ana"},{id:"s2",teamId:"b",name:"Bea"}];
function card(id:string,roundId:string,a:number,b:number,speakers:RoundScorecard["speakers"]=[]):RoundScorecard{return{id,roundId,roundName:roundId,roomId:id,roomName:id,teamFavorId:"a",teamContraId:"b",judges:[],teams:[{teamId:"a",teamName:"A",categoryScores:{},total:a,minorFaults:0,majorFaults:0},{teamId:"b",teamName:"B",categoryScores:{},total:b,minorFaults:0,majorFaults:0}],speakers,createdAt:1,updatedAt:1};}
describe("tournament rankings",()=>{
 it("orders teams by wins then total items and ignores elimination rounds",()=>{const rows=buildTeamRanking(teams,rounds,[card("1","q",10,8),card("2","q",10,9),card("3","q",7,7),card("4","e",100,0)]);expect(rows.map(x=>[x.teamId,x.wins,x.losses,x.itemTotal,x.rank])).toEqual([["a",2,0,20,1],["b",0,2,17,2],["c",0,0,0,3]]);});
 it("uses cumulative speaker scores globally and by position",()=>{const s:RoundScorecard["speakers"]=[{speakerId:"s1",speakerName:"Ana",teamId:"a",position:"introductor",score:8},{speakerId:"s1",speakerName:"Ana",teamId:"a",position:"first_rebuttal",score:7},{speakerId:"s2",speakerName:"Bea",teamId:"b",position:"introductor",score:8}];const r=buildSpeakerRankings(teams,speakers,rounds,[card("1","q",10,8,s),card("2","q",10,8,[{...s[0],score:6}]),card("3","e",10,8,[{...s[0],score:10}])]);expect(r[0].rows.map(x=>[x.speakerId,x.itemTotal,x.evaluations,x.rank])).toEqual([["s1",21,3,1],["s2",8,1,2]]);expect(r[1].rows.map(x=>[x.speakerId,x.itemTotal,x.evaluations])).toEqual([["s1",14,2],["s2",8,1]]);expect(r[2].rows[0].itemTotal).toBe(7);});
 it("returns no entries without applicable speaker scores",()=>{expect(buildSpeakerRankings(teams,speakers,rounds,[card("1","q",1,0,[]) ]).every(x=>x.rows.length===0)).toBe(true);});
});
