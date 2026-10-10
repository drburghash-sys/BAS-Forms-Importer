"use strict";
const $ = (sel) => document.querySelector(sel);
const esc = (text) => String(text ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const TYPE_LABELS = {short_text:"إجابة قصيرة",paragraph:"فقرة",single_choice:"اختيار واحد",multiple_choice:"اختيارات متعددة",dropdown:"قائمة منسدلة",linear_scale:"مقياس ١–٥",date:"تاريخ",time:"وقت",grid:"شبكة خيارات"};
const CHOICE_TYPES = new Set(["single_choice","multiple_choice","dropdown"]);
let formData = {title:"",description:"",questions:[],warnings:[],source:""};
let currentStep=1;
const libPromises={};

function message(text,type="ok") {
  const el=$("#status");el.hidden=false;el.textContent=text;el.className="status"+(type==="error"?" error":type==="waiting"?" waiting":"");
}
function showStep(n) {
  currentStep=n;
  $("#importPanel").hidden=n!==1;$("#editPanel").hidden=n!==2;$("#exportPanel").hidden=n!==3;
  $("#previewPanel").hidden=true;
  document.querySelectorAll(".step").forEach(el=>{const s=Number(el.dataset.step);el.classList.toggle("active",s===n);el.classList.toggle("done",s<n);});
  window.scrollTo({top:0,behavior:"smooth"});
}
function validForm(f) {
  if(!f||typeof f!=="object"||!Array.isArray(f.questions))throw Error("لم أجد قائمة أسئلة قابلة للاستيراد في هذا الملف.");
  const questions=f.questions.map((q,i)=>{
    const type=TYPE_LABELS[q.type]?q.type:(q.type==="checkbox"?"multiple_choice":q.type==="text"?"short_text":"short_text");
    const options=Array.isArray(q.options)?q.options.map(o=>String(typeof o==="object"?(o.label??o.value??""):o)).filter(Boolean):[];
    return {id:String(i+1),title:String(q.title??q.question??q.text??"").trim(),type,options,required:!!q.required,
      rows:Array.isArray(q.rows)?q.rows:[],columns:Array.isArray(q.columns)?q.columns:[]};
  }).filter(q=>q.title).slice(0,600);
  if(!questions.length)throw Error("الملف قابل للقراءة، لكن لم أتعرف على أي سؤال. جرّب صورة أو PDF أو تنسيقًا آخر.");
  return {title:String(f.title||"استبيان مستورد"),description:String(f.description||""),source:String(f.source||f.imported_from||""),questions,warnings:Array.isArray(f.warnings)?f.warnings:[]};
}
function acceptForm(raw,source) {
  formData=validForm(raw);formData.source=source||formData.source;
  $("#formTitle").value=formData.title;$("#formDesc").value=formData.description;
  renderEditor();message("تم استخراج "+formData.questions.length+" سؤالًا بنجاح. راجع الأسئلة والخيارات قبل المتابعة.");
  showStep(2);
}
function getFirstJSONArray(raw) {
  if(!raw)return null;
  const start=raw.indexOf("[");if(start<0)return null;
  let depth=0,inQuote=false,escapeNext=false;
  for(let i=start;i<raw.length;i++){
    const c=raw[i];if(escapeNext){escapeNext=false;continue;}
    if(inQuote){if(c==="\\")escapeNext=true;else if(c==='"')inQuote=false;continue;}
    if(c==='"'){inQuote=true;continue;}
    if(c==="[")depth++;else if(c==="]"){depth--;if(depth===0){try{return JSON.parse(raw.slice(start,i+1));}catch{return null;}}}
  }
  return null;
}
function parseGoogleFormDOM(doc){
  const nodes=[...doc.querySelectorAll("[data-params]")];
  const questions=[];const warnings=[];
  const typeMap={0:"short_text",1:"paragraph",2:"single_choice",3:"dropdown",4:"multiple_choice",5:"linear_scale",6:"grid",7:"grid",9:"date",10:"time"};
  for(const el of nodes){
    const value=getFirstJSONArray(el.getAttribute("data-params"));
    if(!value||typeof value[0]!=="number"||typeof value[1]!=="string"||typeof value[3]!=="number")continue;
    const type=typeMap[value[3]]||"short_text";
    const main=Array.isArray(value[4])?value[4][0]:null;
    const optRaw=Array.isArray(main?.[1])?main[1]:[];
    let options=optRaw.map(o=>Array.isArray(o)?o[0]:o).filter(o=>typeof o==="string"&&o.trim()).map(o=>o.trim());
    let rows=[],columns=[];
    if(type==="grid"){
      rows=options;columns=Array.isArray(value[4]?.[1]?.[1])?value[4][1][1].map(o=>Array.isArray(o)?o[0]:o).filter(Boolean):[];
      warnings.push("السؤال «"+value[1].trim()+"» من نوع شبكة. راجع الصفوف والأعمدة يدويًا بعد الاستيراد.");
    }
    const title=value[1].trim();
    if(!title)continue;
    questions.push({title,type,options,required:main?.[2]===true,rows,columns});
  }
  if(!questions.length)return null;
  let title=doc.querySelector('[role="heading"][aria-level="1"]')?.textContent?.trim()||doc.querySelector("h1")?.textContent?.trim()||doc.title||"استبيان مستورد";
  let description=doc.querySelector(".cBGGJ")?.textContent?.trim()||doc.querySelector('[role="heading"][aria-level="2"]')?.textContent?.trim()||"";
  if(description===title)description="";
  return {title,description,questions,warnings,source:"Google Forms saved page"};
}
function parseGenericDOM(doc) {
  const google=parseGoogleFormDOM(doc);if(google)return google;
  const title=doc.title||doc.querySelector("h1")?.textContent||"استبيان من صفحة ويب";
  const questions=[];
  doc.querySelectorAll("fieldset").forEach(fs=>{
    const title=fs.querySelector("legend")?.textContent?.trim();
    if(!title)return;
    const els=[...fs.querySelectorAll('input[type="radio"],input[type="checkbox"],select option')];
    const options=els.map(e=>e.closest("label")?.textContent?.trim()||e.textContent?.trim()||e.value).filter(Boolean);
    const multi=!!fs.querySelector('input[type="checkbox"]');
    questions.push({title,type:els.length?(multi?"multiple_choice":"single_choice"):"short_text",options:[...new Set(options)],required:!!fs.querySelector("[required]")});
  });
  if(questions.length)return {title,description:"",questions,source:"HTML form",warnings:[]};
  const text=doc.body?.innerText||doc.body?.textContent||"";
  const plain=parsePlainText(text);
  plain.title=title;plain.warnings.push("هذه الصفحة لا تحتوي على بنية أسئلة معروفة؛ استخرجنا النصوص المحتملة. راجع كل سؤال.");return plain;
}
function extractMHT(raw){
  const start=raw.search(/<!doctype\s+html|<html(?:\s|>)/i);
  if(start<0)throw Error("تعذر العثور على صفحة HTML داخل ملف MHT. احفظ الصفحة مجددًا من Chrome أو جرّب PDF.");
  const end=raw.indexOf("</html>",start);if(end<0)throw Error("صفحة HTML المحفوظة غير مكتملة.");
  return raw.slice(start,end+7);
}
function parseHTML(raw){return parseGenericDOM(new DOMParser().parseFromString(raw,"text/html"));}
function parsePlainText(text) {
  text=String(text||"").replace(/\r/g,"").replace(/[\u200e\u200f]/g,"").trim();
  const lines=text.split("\n").map(l=>l.trim()).filter(Boolean);
  if(!lines.length)throw Error("النص فارغ.");
  const questions=[];const warnings=[];
  let current=null;
  const looksOption=(s)=>/^(?:[-•*●◦]|[أابتثجدهـوزحط]\s*[)\.\-]|[A-Da-d]\s*[)\.\-])\s*\S/.test(s);
  const cleaned=(s)=>s.replace(/^(?:[-•*●◦]|[أابتثجدهـوزحطA-Da-d]\s*[)\.\-])\s*/,"").trim();
  const looksQuestion=(s)=>/^(?:س\s*\d+\s*[:).\-]|سؤال\s*\d+|\d+\s*[.)-])\s*/.test(s)||/[؟?]\s*$/.test(s);
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(looksOption(line) && current){current.options.push(cleaned(line));if(current.type==="short_text")current.type="single_choice";continue;}
    if(looksQuestion(line)||!current){
      const title=line.replace(/^(?:س\s*\d+|سؤال\s*\d+|\d+)\s*[:.)-]\s*/,"").trim();
      current={title,type:"short_text",required:false,options:[]};questions.push(current);continue;
    }
    // When choice text follows a numbered question, recognise short unnumbered answer lines.
    if(current && current.options.length && line.length<90&&!looksQuestion(line)){current.options.push(line);continue;}
    // Blank-line formatting is not preserved; prefer new question to silently merging text.
    current={title:line,type:"short_text",required:false,options:[]};questions.push(current);
  }
  if(questions.length>80)warnings.push("عدد الأسطر المستخرجة كبير؛ قد يحتوي الملف على عناوين ليست أسئلة.");
  warnings.push("الملفات النصية لا توضح دائمًا نوع السؤال أو إلزاميته؛ يرجى مراجعتها.");
  return {title:"استبيان مستورد من نص",description:"",questions,warnings,source:"Plain text"};
}
function parseDelimited(text,delimiter=","){
  const rows=[];let row=[],field="",quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===delimiter&&!quoted){row.push(field);field="";}else if((c==="\n"||c==="\r")&&!quoted){if(c==="\r"&&text[i+1]==="\n")i++;row.push(field);if(row.some(x=>x.trim()))rows.push(row);row=[];field="";}else field+=c;}
  row.push(field);if(row.some(x=>x.trim()))rows.push(row);return rows;
}
function parseRows(rows,source){
  const meaningful=rows.filter(row=>row.some(x=>String(x||"").trim()));
  if(!meaningful.length)throw Error("الجدول فارغ.");
  let headers=meaningful[0].map(x=>String(x||"").toLowerCase().trim());
  const col=(p)=>headers.findIndex(h=>p.test(h));
  const qcol=col(/question|السؤال|السوال|نص السؤال|title/), opcol=col(/options|choices|الخيارات|الاختيارات|الإجابات/), typecol=col(/type|نوع/), reqcol=col(/required|إلزامي/);
  const structured=qcol>=0;const data=structured?meaningful.slice(1):meaningful;
  const questions=data.map(row=>{
    let title=String(row[structured?qcol:0]||"").trim();if(!title)return null;
    let options=[];
    if(structured&&opcol>=0)options=String(row[opcol]||"").split(/\s*[|؛;،]\s*/).filter(Boolean);
    else options=row.slice(1).map(s=>String(s||"").trim()).filter(Boolean);
    let type=options.length?"single_choice":"short_text";
    if(structured&&typecol>=0){const raw=String(row[typecol]||"").toLowerCase();if(/multi|checkbox|متعدد/.test(raw))type="multiple_choice";else if(/para|فقرة/.test(raw))type="paragraph";else if(/drop|قائمة/.test(raw))type="dropdown";}
    const required=structured&&reqcol>=0&&/^(true|yes|1|نعم|إلزامي)$/i.test(String(row[reqcol]).trim());
    return {title,type,required,options};
  }).filter(Boolean);
  return {title:"استبيان من جدول",description:"",questions,source,warnings:["تأكد من أن الأعمدة مرتبطة بالأسئلة والخيارات الصحيحة قبل التصدير."]};
}
function parseJSON(text){
  const data=JSON.parse(text);
  if(Array.isArray(data))return {title:"استبيان مستورد",questions:data,description:""};
  if(data.form&&Array.isArray(data.form.questions))return data.form;
  if(data.questions)return data;
  throw Error("ملف JSON لا يحتوي على مصفوفة questions. استخدم ملفات البرنامج أو JSON بتنسيق الأسئلة.");
}
function loadLib(key,url,verify){
  if(verify())return Promise.resolve();
  if(libPromises[key])return libPromises[key];
  libPromises[key]=new Promise((resolve,reject)=>{
    const el=document.createElement("script");el.src=url;el.async=true;
    el.onload=()=>verify()?resolve():reject(Error("تعذر تهيئة مكتبة "+key));
    el.onerror=()=>reject(Error("تعذر تحميل مكتبة "+key+". تحقق من اتصال الإنترنت ثم حاول مرة أخرى."));
    document.head.appendChild(el);
  });
  return libPromises[key].catch(e=>{delete libPromises[key];throw e;});
}
async function pdfText(file){
  await loadLib("PDF", "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js",()=>!!window.pdfjsLib);
  pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  const pdf=await pdfjsLib.getDocument({data:await file.arrayBuffer()}).promise;
  const pages=[];
  for(let i=1;i<=pdf.numPages;i++){
    const page=await pdf.getPage(i);const items=(await page.getTextContent()).items;
    let lines=[],line="",oldY=null;
    items.forEach(x=>{const y=x.transform?.[5]??0;if(oldY!==null&&Math.abs(y-oldY)>3){lines.push(line);line="";}line+=(x.str||"")+" ";oldY=y;});if(line.trim())lines.push(line);
    pages.push(lines.join("\n"));
  }
  return pages.join("\n\n");
}
async function docxText(file){
  await loadLib("Word","https://cdn.jsdelivr.net/npm/mammoth@1.9.0/mammoth.browser.min.js",()=>!!window.mammoth);
  return (await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()})).value;
}
async function spreadsheetRows(file){
  await loadLib("Excel","https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js",()=>!!window.ExcelJS);
  const book=new ExcelJS.Workbook();await book.xlsx.load(await file.arrayBuffer());
  const sheet=book.worksheets[0];if(!sheet)throw Error("ملف Excel لا يحتوي على صفحات.");
  const rows=[];sheet.eachRow(row=>rows.push(row.values.slice(1).map(cell=>typeof cell==="object"?(cell?.text||cell?.result||""):cell??"")));
  return rows;
}
async function detectQR(file){
  if(!("BarcodeDetector" in window))return "";
  try{const reader=new BarcodeDetector({formats:["qr_code"]});const b=await createImageBitmap(file);const codes=await reader.detect(b);b.close?.();return codes[0]?.rawValue||"";}catch{return "";}
}
async function imageText(file){
  const qr=await detectQR(file);
  if(qr && /^https?:\/\//i.test(qr)){ $("#urlInput").value=qr;throw Error("تم اكتشاف رابط في رمز QR: "+qr+"\nالرابط لا يتضمن نص الأسئلة. افتح الاستبيان واحفظ الصفحة بصيغة MHT وارفعها هنا."); }
  await loadLib("OCR","https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",()=>!!window.Tesseract);
  message("جارٍ تنزيل نموذج التعرف على العربية والإنجليزية وتحليل الصورة. قد يستغرق ذلك قليلًا...","waiting");
  const result=await Tesseract.recognize(file,"ara+eng");
  return result?.data?.text||"";
}
async function importFile(file){
  if(!file)return;
  if(file.size>25*1024*1024){message("الحد الأعلى الحالي للملف ٢٥ ميجابايت. قسّم الملف إلى أجزاء أصغر.","error");return;}
  const ext=(file.name.split(".").pop()||"").toLowerCase();
  const friendly={mht:"MHT",mhtml:"MHT",html:"HTML",htm:"HTML",json:"JSON",txt:"نص",md:"Markdown",csv:"CSV",pdf:"PDF",docx:"Word",xlsx:"Excel",png:"صورة",jpg:"صورة",jpeg:"صورة",webp:"صورة",gif:"صورة"};
  if(!friendly[ext]){message("الصيغة ."+ext+" غير مدعومة حاليًا. الملفات DOC/XLS القديمة تتطلب تحويلها إلى DOCX/XLSX.","error");return;}
  message("جارٍ قراءة الملف: "+file.name,"waiting");
  try{
    let data;
    if(["mht","mhtml"].includes(ext))data=parseHTML(extractMHT(await file.text()));
    else if(["html","htm"].includes(ext))data=parseHTML(await file.text());
    else if(ext==="json")data=parseJSON(await file.text());
    else if(["txt","md"].includes(ext))data=parsePlainText(await file.text());
    else if(ext==="csv")data=parseRows(parseDelimited((await file.text()).replace(/^\ufeff/,""),","),"CSV");
    else if(ext==="pdf"){data=parsePlainText(await pdfText(file));data.warnings.push("إذا كان PDF صورًا ممسوحة ضوئيًا، فقد لا تظهر كل الأسئلة. جرّب رفع صور الصفحات.");}
    else if(ext==="docx"){data=parsePlainText(await docxText(file));data.warnings.push("قد لا يحافظ استخراج Word على تنسيق الجداول والاختيارات.");}
    else if(ext==="xlsx")data=parseRows(await spreadsheetRows(file),"Excel");
    else {data=parsePlainText(await imageText(file));data.warnings.push("الأسئلة المستخرجة من الصور قد تحوي أخطاء تعرف ضوئي؛ تدقق النصوص والاختيارات قبل التصدير.");}
    if(!["json","mht","mhtml","html","htm"].includes(ext))data.title=file.name.replace(/\.[^.]+$/,"");
    acceptForm(data,file.name);
  }catch(err){message(err.message||"حدث خطأ أثناء قراءة الملف.","error");}
}
function renderEditor(){
  $("#metrics").innerHTML='<div class="metric"><strong>'+formData.questions.length+'</strong>سؤالًا</div><div class="metric"><strong>'+formData.questions.filter(q=>q.required).length+'</strong>إلزاميًا</div><div class="metric"><strong>'+formData.questions.filter(q=>CHOICE_TYPES.has(q.type)).length+'</strong>بالاختيارات</div>';
  const warning=$("#warning");warning.hidden=!formData.warnings.length;warning.textContent=formData.warnings.join("\n");
  $("#questions").innerHTML=formData.questions.map((q,i)=>{
    const opts=Object.entries(TYPE_LABELS).map(([t,name])=>'<option value="'+t+'"'+(q.type===t?' selected':'')+'>'+name+'</option>').join("");
    return '<article class="question" data-index="'+i+'"><div class="question-top"><span class="question-label">السؤال '+(i+1)+'</span><div class="q-actions"><button type="button" class="small-btn" data-act="up" aria-label="رفع السؤال">↑</button><button type="button" class="small-btn" data-act="down" aria-label="خفض السؤال">↓</button><button type="button" class="small-btn danger" data-act="remove" aria-label="حذف السؤال">حذف</button></div></div><div class="question-grid"><div><label>نص السؤال</label><textarea rows="2" data-field="title">'+esc(q.title)+'</textarea></div><div><label>نوع السؤال</label><select data-field="type">'+opts+'</select></div></div>'+
    (CHOICE_TYPES.has(q.type)?'<div class="q-options"><label>الخيارات — كل خيار في سطر</label><textarea data-field="options" rows="'+Math.max(3,Math.min(8,q.options.length))+'">'+esc(q.options.join("\n"))+'</textarea><div class="hint">يمكن تعديل أو إضافة أي خيار.</div></div>':q.type==="grid"?'<p class="note warning">أسئلة الشبكة تحتاج مراجعة الصفوف والأعمدة في Google Forms بعد الإنشاء؛ الملف المحوّل سيستخدم سؤالًا نصيًا مؤقتًا.</p>':'')+
    '<div class="q-footer"><label><input type="checkbox" data-field="required"'+(q.required?' checked':'')+'> سؤال إلزامي</label></div></article>';
  }).join("");
}
function syncMeta(){formData.title=$("#formTitle").value.trim()||"استبيان مستورد";formData.description=$("#formDesc").value;}
$("#questions").addEventListener("input",e=>{
  const field=e.target.dataset.field;const card=e.target.closest("[data-index]");if(!field||!card)return;
  const q=formData.questions[Number(card.dataset.index)];
  if(field==="title")q.title=e.target.value;
  else if(field==="options")q.options=e.target.value.split("\n").map(s=>s.trim()).filter(Boolean);
  else if(field==="required")q.required=e.target.checked;
});
$("#questions").addEventListener("change",e=>{
  const card=e.target.closest("[data-index]");if(!card)return;
  const q=formData.questions[Number(card.dataset.index)];
  if(e.target.dataset.field==="type"){q.type=e.target.value;if(CHOICE_TYPES.has(q.type)&&!q.options.length)q.options=["الخيار الأول","الخيار الثاني"];renderEditor();}
  if(e.target.dataset.field==="required")q.required=e.target.checked;
});
$("#questions").addEventListener("click",e=>{
  const button=e.target.closest("[data-act]");if(!button)return;
  const idx=Number(button.closest("[data-index]").dataset.index),act=button.dataset.act;
  if(act==="remove"){if(!confirm("حذف هذا السؤال؟"))return;formData.questions.splice(idx,1);}
  else if(act==="up"&&idx>0)[formData.questions[idx-1],formData.questions[idx]]=[formData.questions[idx],formData.questions[idx-1]];
  else if(act==="down"&&idx<formData.questions.length-1)[formData.questions[idx+1],formData.questions[idx]]=[formData.questions[idx],formData.questions[idx+1]];
  renderEditor();
});
$("#addQuestion").onclick=()=>{formData.questions.push({title:"سؤال جديد",type:"single_choice",required:false,options:["نعم","لا"]});renderEditor();document.querySelector("#questions article:last-child")?.scrollIntoView({behavior:"smooth"});};
function buildData(){syncMeta();return {title:formData.title,description:formData.description,version:1,questions:formData.questions.map((q,i)=>({...q,order:i+1}))};}
$("#nextBtn").onclick=()=>{
  const form=buildData();
  if(!form.questions.length)return alert("أضف سؤالًا واحدًا على الأقل.");
  if(form.questions.some(q=>!q.title.trim()))return alert("يوجد سؤال بلا عنوان.");
  if(form.questions.some(q=>CHOICE_TYPES.has(q.type)&&q.options.length<2))return alert("أحد أسئلة الاختيار يحتوي على أقل من خيارين.");
  $("#exportStats").innerHTML='<div class="metric"><strong>'+form.questions.length+'</strong>سؤالًا جاهزًا</div><div class="metric">حفظ البيانات محليًا فقط</div>';
  showStep(3);
};
$("#backBtn").onclick=()=>showStep(2);
$("#startOver").onclick=()=>{if(confirm("بدء استيراد جديد؟ ستفقد التعديلات الحالية إن لم تصدّرها.")){formData={title:"",description:"",questions:[],warnings:[],source:""};$("#fileInput").value="";$("#status").hidden=true;showStep(1);}};
$("#previewBtn").onclick=()=>{
  const f=buildData();const out=f.questions.map((q,i)=>{
    let body="";
    if(CHOICE_TYPES.has(q.type))body=q.options.map((o,j)=>'<label class="preview-opt"><input type="'+(q.type==="multiple_choice"?"checkbox":"radio")+'" name="q'+i+'"> '+esc(o)+'</label>').join("");
    else if(q.type==="paragraph")body='<textarea rows="3" placeholder="إجابتك"></textarea>';
    else if(q.type==="linear_scale")body='<input type="range" min="1" max="5" value="3">';
    else body='<input placeholder="إجابتك" disabled>';
    return '<div class="preview-item"><label>'+(i+1)+'. '+esc(q.title)+(q.required?' <span style="color:#b22">*</span>':'')+'</label>'+body+'</div>';
  }).join("");
  $("#previewBody").innerHTML='<h3>'+esc(f.title)+'</h3><p>'+esc(f.description)+'</p>'+out+'<p class="note">معاينة فقط؛ لا تُرسل إجابات من هذه الشاشة.</p>';
  $("#previewPanel").hidden=false;$("#previewPanel").scrollIntoView({behavior:"smooth"});
};
$("#closePreview").onclick=()=>$("#previewPanel").hidden=true;
function download(filename,text,mime="text/plain;charset=utf-8"){
  const blob=new Blob(["\ufeff",text],{type:mime});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function safeName(s){return String(s||"survey").replace(/[\\/:*?"<>|]/g,"-").slice(0,70);}
$("#jsonBtn").onclick=()=>{const f=buildData();download(safeName(f.title)+".json",JSON.stringify(f,null,2),"application/json;charset=utf-8");};
$("#txtBtn").onclick=()=>{const f=buildData();download(safeName(f.title)+".txt",f.title+"\n"+f.description+"\n\n"+f.questions.map((q,i)=>(i+1)+". "+q.title+(q.required?" *":"")+(q.options.length?"\n"+q.options.map(o=>"- "+o).join("\n"):"")).join("\n\n"));};
function appsScript(f){
  const embedded=JSON.stringify(JSON.stringify(f));
  return '// BAS Forms Importer — شغّل createImportedForm مرة واحدة فقط\n'+
    'function createImportedForm() {\n'+
    '  const data = JSON.parse('+embedded+');\n'+
    '  const form = FormApp.create(data.title || "استبيان مستورد");\n'+
    '  if (data.description) form.setDescription(data.description);\n'+
    '  data.questions.forEach(function(q) {\n'+
    '    let item;\n'+
    '    switch(q.type) {\n'+
    '      case "single_choice": item=form.addMultipleChoiceItem(); item.setChoiceValues(q.options); break;\n'+
    '      case "multiple_choice": item=form.addCheckboxItem(); item.setChoiceValues(q.options); break;\n'+
    '      case "dropdown": item=form.addListItem(); item.setChoiceValues(q.options); break;\n'+
    '      case "paragraph": item=form.addParagraphTextItem(); break;\n'+
    '      case "linear_scale": item=form.addScaleItem().setBounds(1,5); break;\n'+
    '      case "date": item=form.addDateItem(); break;\n'+
    '      case "time": item=form.addTimeItem(); break;\n'+
    '      case "grid": item=form.addParagraphTextItem(); break; // مراجعة يدوية\n'+
    '      default: item=form.addTextItem();\n'+
    '    }\n'+
    '    item.setTitle(q.title).setRequired(Boolean(q.required));\n'+
    '  });\n'+
    '  Logger.log("EDIT: "+form.getEditUrl());\n'+
    '  Logger.log("RESPOND: "+form.getPublishedUrl());\n'+
    '  return form.getEditUrl();\n'+
    '}\n';
}
$("#gsBtn").onclick=()=>{const f=buildData();if(f.questions.some(q=>q.type==="grid"))alert("يوجد سؤال شبكة؛ سيُنشأ كسؤال نصي مؤقت، ويلزم إعداده يدويًا في جوجل.");download("BAS-Create-Google-Form.gs",appsScript(f),"text/plain;charset=utf-8");};
const drop=$("#dropzone"),picker=$("#fileInput");
drop.addEventListener("click",()=>picker.click());
drop.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();picker.click();}});
picker.addEventListener("change",e=>importFile(e.target.files[0]));
["dragenter","dragover"].forEach(type=>drop.addEventListener(type,e=>{e.preventDefault();drop.classList.add("dragging");}));
["dragleave","drop"].forEach(type=>drop.addEventListener(type,e=>{e.preventDefault();drop.classList.remove("dragging");}));
drop.addEventListener("drop",e=>importFile(e.dataTransfer.files[0]));
$("#pasteBtn").onclick=()=>{try{acceptForm(parsePlainText($("#pasteInput").value),"نص ملصق");}catch(err){message(err.message,"error");}};
$("#urlBtn").onclick=async()=>{
  const url=$("#urlInput").value.trim();if(!url)return message("ألصق رابطًا أولًا.","error");
  let parsed;try{parsed=new URL(url);if(!["http:","https:"].includes(parsed.protocol))throw Error();}catch{return message("الرابط غير صالح. يجب أن يبدأ بـ https://","error");}
  message("جارٍ محاولة قراءة الرابط...","waiting");
  try{
    const response=await fetch(parsed.href,{mode:"cors",credentials:"omit"});
    if(!response.ok)throw Error("HTTP "+response.status);
    acceptForm(parseHTML(await response.text()),parsed.href);
  }catch{
    message("المتصفح لا يستطيع قراءة أسئلة هذا الرابط مباشرة (غالبًا بسبب حماية CORS أو صلاحيات الموقع).\nافتح الاستبيان الأصلي من Chrome ← حفظ الصفحة كملف MHT ← ثم ارفع الملف هنا. لا تحتاج إذن تحرير النموذج.","error");
  }
};
