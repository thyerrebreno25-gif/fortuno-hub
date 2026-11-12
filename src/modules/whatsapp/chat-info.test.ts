import {expect,it} from "vitest";
import {chatProfile} from "./chat-info";
it("reads the documented group description and member count without returning raw participant details",()=>{
 const profile=chatProfile({Name:"Grupo do cliente",Topic:"Descrição do grupo",ParticipantCount:82,Participants:[{JID:"private"}],token:"secret",GroupCreated:"2025-01-01T12:00:00Z"},true);
 expect(profile).toMatchObject({name:"Grupo do cliente",description:"Descrição do grupo",memberCount:82,createdAt:"2025-01-01T12:00:00.000Z"});expect(JSON.stringify(profile)).not.toContain("private");expect(JSON.stringify(profile)).not.toContain("secret");
});
it("does not show a deleted group description or fabricate unavailable contact details",()=>{expect(chatProfile({Topic:"deleted",TopicDeleted:true,Participants:null},true)).toMatchObject({description:null,memberCount:null});expect(chatProfile({name:"Contato"},false)).toMatchObject({name:"Contato",description:null,memberCount:null});});
it("rejects unsafe profile image locations",()=>{expect(chatProfile({image:"https://evil.example/tracker",name:"Contato"},false).photo).toBeNull();});

it("projects member names, roles and availability alongside the group information",()=>{
 expect(chatProfile({Participants:[{JID:"123456789012345@lid",IsAdmin:true}],participant_profiles:[{lid:"123456789012345@lid",display_name:"Pessoa do grupo"}]},true)).toMatchObject({participantsAvailable:true,memberCount:1,participants:[{name:"Pessoa do grupo",phone:null,isAdmin:true}]});
 expect(chatProfile({Name:"Sem lista"},true).participantsAvailable).toBe(false);
});
