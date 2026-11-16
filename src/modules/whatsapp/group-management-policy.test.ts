import {describe,expect,it} from "vitest";
import {canManageGroupInHub,canRemoveGroupMember,groupAccountIsAdmin,groupParticipantInput,participantOperationResult} from "./group-management-policy";
import type {GroupMember} from "./group-members";
const person:GroupMember={id:"5511999999999@s.whatsapp.net",phone:"5511999999999",lid:"123456789012345@lid",name:"Pessoa",isAdmin:false,isSuperAdmin:false,photo:null};
const requestId="448e878d-cc2d-4bd0-a069-6907d3f79fb8";
describe("group membership controls",()=>{
 it("requires Hub edit permission and ownership, except for authorized managers",()=>{
  const permission={canView:true,canEdit:true},ticket={assignedToId:"operator",status:"IN_PROGRESS"};
  expect(canManageGroupInHub("OPERATOR",permission,"operator",ticket)).toBe(true);
  expect(canManageGroupInHub("OPERATOR",permission,"other",ticket)).toBe(false);
  expect(canManageGroupInHub("OPERATOR",permission,"operator",{...ticket,status:"RESOLVED"})).toBe(false);
  expect(canManageGroupInHub("MANAGER",permission,"other",ticket)).toBe(true);
  expect(canManageGroupInHub("MASTER",{...permission,canEdit:false},"other",ticket)).toBe(false);
  expect(canManageGroupInHub("CLIENT",{...permission,canManage:true},"operator",ticket)).toBe(false);
 });
 it("requires confirmed group admin rights, not just another admin in the group",()=>{
  expect(groupAccountIsAdmin({accountIsAdmin:false,participants:[{...person,isAdmin:true}]},"5511888888888")).toBe(false);
  expect(groupAccountIsAdmin({accountIsAdmin:false,participants:[{...person,isAdmin:true}]},person.phone!)).toBe(true);
  expect(groupAccountIsAdmin({accountIsAdmin:true,participants:[]},"5511888888888")).toBe(true);
 });
 it("protects the connected account and owner, including LID aliases",()=>{
  expect(canRemoveGroupMember(person,person.phone!,null)).toBe(false);
  expect(canRemoveGroupMember({...person,isSuperAdmin:true},"5511888888888",null)).toBe(false);
  expect(canRemoveGroupMember(person,"5511888888888",person.lid)).toBe(false);
  expect(canRemoveGroupMember(person,"5511888888888",null)).toBe(true);
 });
 it("validates international numbers without converting LIDs or malformed phone text",()=>{
  expect(groupParticipantInput.parse({action:"add",participant:"+55 (11) 99999-9999",requestId}).participant).toBe(person.phone);
  for(const participant of ["abc5511999999999",person.lid,"5511", "https://example.com"]){expect(groupParticipantInput.safeParse({action:"add",participant,requestId}).success).toBe(false);}
  expect(groupParticipantInput.safeParse({action:"remove",participant:person.lid,requestId}).success).toBe(true);
  expect(groupParticipantInput.safeParse({action:"promote",participant:person.id,requestId}).success).toBe(false);
 });
 it("does not mistake HTTP success, another member, or a privacy failure for a successful addition",()=>{
  expect(participantOperationResult({groupUpdated:[{JID:person.id,Error:0}]},[person.id],"add").ok).toBe(true);
  expect(participantOperationResult({groupUpdated:[{JID:person.id,Error:403,AddRequest:{Code:"private"}}]},[person.id],"add")).toMatchObject({ok:false,message:expect.stringContaining("privacidade")});
  for(const body of [{success:true},{groupUpdated:[{JID:"other",Error:0}]},{groupUpdated:[{JID:person.id}]}])expect(participantOperationResult(body,[person.id],"remove").ok).toBe(false);
 });
});
