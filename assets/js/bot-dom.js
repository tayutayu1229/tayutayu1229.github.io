/* Audited template renderer: inert parsing, tag/attribute allowlist, no URLs or events. */
(() => {
 'use strict';
 const tags=new Set(['div','span','b','strong','small','p','br','article','details','summary','label','input','textarea','button','option','dt','dd','h4','svg','line','text','polyline']);
 const attributes=new Set(['id','class','type','value','checked','selected','rows','inputmode','min','max','placeholder','data-repo','x','y','x1','x2','y1','y2','stroke','fill','points','font-size','text-anchor','stroke-width']);
 function render(target,markup){
  if(!target)return;
  if(!markup){target.replaceChildren();return;}
  const template=document.createElement('template');
  template.innerHTML=String(markup);
  function clean(parent){for(const node of [...parent.childNodes]){
   if(node.nodeType===3)continue;
   if(node.nodeType!==1||!tags.has(node.localName)){node.remove();continue;}
   for(const attribute of [...node.attributes]){if((!attributes.has(attribute.name)&&!/^aria-[a-z-]+$/.test(attribute.name))||(['fill','stroke'].includes(attribute.name)&&! /^(?:#[0-9a-fA-F]{3,8}|none)$/.test(attribute.value)))node.removeAttribute(attribute.name);}
   clean(node);
  }}
  clean(template.content);target.replaceChildren(template.content);
 }
 window.BotDom=Object.freeze({render});
})();
