import { expect, it } from "vitest";
import { activitySelection } from "./activity-selection";
const activities=[{id:"open",status:"OPEN",responsibleId:"u"},{id:"closed",status:"COMPLETED",responsibleId:"other"},{id:"other",status:"OPEN",responsibleId:"other"}];
const manager={canEdit:true,canDelete:true,canManage:true,userId:"manager"};
it("uses marked visible rows for deletion and separates only transferable marked rows for transfer",()=>{
 const result=activitySelection(activities,["open","closed"],manager);
 expect(result.selectableIds).toEqual(["open","closed","other"]);
 expect(result.selected.map(row=>row.id)).toEqual(["open","closed"]);
 expect(result.transferableIds).toEqual(["open"]);
});
it("does not include hidden, unmarked or missing activities in the reviewed selection",()=>{
 expect(activitySelection(activities,["missing"],manager).selected).toEqual([]);
 expect(activitySelection(activities,[],manager).selected).toEqual([]);
 expect(activitySelection(activities.slice(1),["open","other"],manager).selected.map(row=>row.id)).toEqual(["other"]);
});
it("preserves operator transfer ownership and read-only restrictions",()=>{
 const operator={canEdit:true,canDelete:false,canManage:false,userId:"u"};
 expect(activitySelection(activities,["open","closed","other"],operator)).toMatchObject({selectableIds:["open"],transferableIds:["open"]});
 expect(activitySelection(activities,["open"],{...manager,canEdit:false}).selected).toEqual([]);
});
