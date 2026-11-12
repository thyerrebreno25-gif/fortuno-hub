import {expect,it} from "vitest";
import {groupMembers,enrichGroupMemberNames} from "./group-members";
it("preserves LID-only members without inventing a phone and resolves names from participant_profiles",()=>{
 const members=groupMembers([{JID:"123456789012345@lid",IsAdmin:true},{JID:"5511999999999@s.whatsapp.net",DisplayName:"Ana"}],[{lid:"123456789012345@lid",display_name:"João Silva",image_preview_url:"https://evil.example/tracker"}]);
 expect(members).toHaveLength(2);expect(members[0]).toMatchObject({id:"123456789012345@lid",phone:null,name:"João Silva",isAdmin:true,photo:null});expect(members[1]).toMatchObject({phone:"5511999999999",name:"Ana"});
});
it("deduplicates LID and phone aliases and keeps all members, including those who never sent a message",()=>{
 const members=groupMembers([{JID:"123456789012345@lid",PhoneNumber:"5511888888888@s.whatsapp.net",IsSuperAdmin:true},{JID:"5511888888888@s.whatsapp.net"},{JID:"5511777777777@s.whatsapp.net"}],[]);
 expect(members).toHaveLength(2);expect(members[0]).toMatchObject({phone:"5511888888888",lid:"123456789012345@lid",isSuperAdmin:true});expect(members[1].name).toBeNull();
});
it("enriches only by exact member identifiers and prefers saved contact names",()=>{
 const members=groupMembers([{JID:"123456789012345@lid",PhoneNumber:"5511888888888@s.whatsapp.net",DisplayName:"Nome WhatsApp"},{JID:"5511777777777@s.whatsapp.net"}],[]);
 const result=enrichGroupMemberNames(members,new Map([["5511888888888@s.whatsapp.net","Isabella Lago"]]),new Map([["5511777777777@s.whatsapp.net","João Gabriel"],["unrelated@lid","Pessoa diferente"]]));
 expect(result.map(member=>member.name)).toEqual(["Isabella Lago","João Gabriel"]);
});
it("does not confuse identifiers with names, expose arbitrary provider fields or add non-member profiles",()=>{
 const members=groupMembers([{JID:"123456789012345@lid",DisplayName:"123456789012345@lid",secret:"private"}],[{jid:"5511888888888@s.whatsapp.net",display_name:"Não é membro"}]);
 expect(members).toHaveLength(1);expect(members[0].name).toBeNull();expect(JSON.stringify(members)).not.toContain("private");expect(groupMembers(null,[])).toEqual([]);
});
