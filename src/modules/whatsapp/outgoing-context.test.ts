import {it,expect} from "vitest";
import {outgoingContext} from "./outgoing-context";
const connection={id:"connection",instanceId:"paid",phone:"5511888888888"};
it("permits the first outbound message without any inbound history",()=>{
 expect(outgoingContext("wa-account:connection:5511888888888","wa-contact:5511999999999",connection,null)).toEqual({instanceId:"paid",to:"5511999999999",replyToMessageId:undefined});
 expect(outgoingContext("wa-account:connection:5511888888888","wa-group:120363000@g.us",connection,null).to).toBe("120363000@g.us");
});
it("rejects sending an old account's conversation after switching the connected phone",()=>{
 expect(()=>outgoingContext("wa-account:connection:old","wa-contact:5511999999999",connection,{provider:"UAZAPI",instanceId:"paid",connectionId:"connection",accountPhone:"old"})).toThrow("agenda atual");
});
it("uses the new instance after reconnecting the same account without quoting an old-instance message",()=>{
 expect(outgoingContext("wa-account:connection:5511888888888","wa-contact:5511999999999",connection,{provider:"UAZAPI",instanceId:"expired",messageId:"old"})).toMatchObject({instanceId:"paid",replyToMessageId:undefined});
});
