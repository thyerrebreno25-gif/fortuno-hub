import {expect,it} from "vitest";
import {isSurveyCoolingDown,nextSurveyBusinessTime,surveyAnswerSchema,surveyPolicySchema,surveySummary,DEFAULT_SURVEY_MESSAGE} from "./survey-core";
it("shares the 15-day cooldown across a client's invitations including declined surveys",()=>{const now=new Date("2026-11-20T15:00:00Z");for(const status of ["SENT","DECLINED","UNKNOWN","EXPIRED"])expect(isSurveyCoolingDown({status,sentAt:new Date("2026-11-06T15:00:00Z"),createdAt:new Date("2026-11-06T14:00:00Z")},15,now)).toBe(true);expect(isSurveyCoolingDown({status:"SENT",sentAt:new Date("2026-11-05T15:00:00Z"),createdAt:new Date("2026-11-05T14:00:00Z")},15,now)).toBe(false);expect(isSurveyCoolingDown({status:"PENDING",sentAt:null,createdAt:new Date(0)},15,now)).toBe(true);});
it("moves Friday evening and Sunday invitations to Monday 16:45 Brasília",()=>{for(const value of ["2026-11-06T20:00:00Z","2026-11-08T15:00:00Z"])expect(nextSurveyBusinessTime(new Date(value)).toISOString()).toBe("2026-11-09T19:45:00.000Z");expect(nextSurveyBusinessTime(new Date("2026-11-09T14:17:00Z")).toISOString()).toBe("2026-11-09T19:45:00.000Z");});
it("requires one link marker and validates scores or an explicit decline",()=>{expect(surveyPolicySchema.safeParse({enabled:true,cadenceDays:15,delayMinutes:30,message:DEFAULT_SURVEY_MESSAGE}).success).toBe(true);expect(surveyPolicySchema.safeParse({enabled:true,cadenceDays:15,delayMinutes:30,message:DEFAULT_SURVEY_MESSAGE+" {{link}}"}).success).toBe(false);expect(surveyAnswerSchema.safeParse({}).success).toBe(false);expect(surveyAnswerSchema.safeParse({score:6}).success).toBe(false);expect(surveyAnswerSchema.safeParse({decline:true,optOut:true}).success).toBe(true);});
it("calculates actual response distribution without treating unconfirmed sends as delivered",()=>{const result=surveySummary([{status:"ANSWERED",score:5,sentAt:new Date()},{status:"ANSWERED",score:3,sentAt:new Date()},{status:"SENT",score:null,sentAt:new Date()},{status:"DECLINED",score:null,sentAt:new Date()},{status:"UNKNOWN",score:null,sentAt:new Date()}]);expect(result).toMatchObject({sent:4,answered:2,average:4,responseRate:50,unconfirmed:1});expect(result.distribution.map(d=>d.count)).toEqual([0,0,1,0,1]);});

it("requires the respondent name for a score, but permits anonymous refusal",()=>{expect(surveyAnswerSchema.safeParse({score:5}).success).toBe(false);expect(surveyAnswerSchema.safeParse({score:5,respondentName:"Cliente Silva"}).success).toBe(true);expect(surveyAnswerSchema.safeParse({decline:true}).success).toBe(true);});

it("uses thirty full days after the answer, independently of when the invitation was sent",()=>{
 const now=new Date("2026-12-10T19:45:00Z");
 const previous={status:"ANSWERED",createdAt:new Date("2026-11-01T18:00:00Z"),sentAt:new Date("2026-11-05T19:45:00Z"),answeredAt:new Date("2026-11-10T19:45:00.001Z")};
 expect(isSurveyCoolingDown(previous,15,now)).toBe(true);
 expect(isSurveyCoolingDown({...previous,answeredAt:new Date("2026-11-10T19:45:00Z")},15,now)).toBe(false);
 expect(isSurveyCoolingDown({...previous,answeredAt:new Date("2026-11-10T19:45:00Z")},45,now)).toBe(true);
});
it("safely falls back for legacy answers without answeredAt and keeps unanswered invitations at fifteen days",()=>{
 const previous={status:"ANSWERED",sentAt:new Date("2026-11-15T19:45:00Z"),createdAt:new Date("2026-11-15T18:00:00Z")},now=new Date("2026-12-10T19:45:00Z");
 expect(isSurveyCoolingDown(previous,15,now)).toBe(true);
 for(const status of ["SENT","DECLINED","UNKNOWN","EXPIRED"])expect(isSurveyCoolingDown({...previous,status},15,now)).toBe(false);
});
