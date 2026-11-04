export const MAX_AVATAR_LENGTH=180000;
export function validAvatar(value:unknown):value is string{
 if(typeof value!=="string"||value.length>MAX_AVATAR_LENGTH)return false;
 const match=value.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/);if(!match||match[1].length%4!==0)return false;
 try{const binary=atob(match[1]);return binary.length>100&&binary.charCodeAt(0)===255&&binary.charCodeAt(1)===216&&binary.charCodeAt(2)===255&&binary.charCodeAt(binary.length-2)===255&&binary.charCodeAt(binary.length-1)===217;}catch{return false;}
}
