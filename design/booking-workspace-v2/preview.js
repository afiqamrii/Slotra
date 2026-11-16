(() => {
'use strict';
const $=selector=>document.querySelector(selector);
const $$=selector=>Array.from(document.querySelectorAll(selector));
const icon=name=>`<svg aria-hidden="true"><use href="#${name}"/></svg>`;
const dates=['Sunday, 15 November','Monday, 16 November','Tuesday, 17 November'];
const stateLabels={available:'Available',playing:'Playing now',arriving:'Arriving soon',blocked:'Maintenance'};
let day=1,selected=3,filter='',queue='upcoming',allCourts=false,drawerOpener=null,searchOpener=null,duration=60,time='6:30 pm',toastTimer;
let venueScene=null,mapView='3d',mapAnchor=null;
const courts=[{id:1,state:'playing',customer:'Amir & friends',until:'7:00 pm',next:'8:00 pm'},{id:2,state:'arriving',customer:'Sarah Lim',until:'8:00 pm',next:'7:00 pm'},{id:3,state:'available',customer:null,until:'8:00 pm',next:'8:00 pm'},{id:4,state:'playing',customer:'Team Wednesday',until:'7:30 pm',next:'8:30 pm'},{id:5,state:'available',customer:null,until:'10:00 pm',next:'10:00 pm'},{id:6,state:'blocked',customer:null,until:'Tomorrow',next:null}];
const sampleBookings=[{id:'a',name:'Sarah Lim',initials:'SL',court:2,time:'7:00 pm',end:'8:00 pm',state:'arriving',payment:'Pay at venue',avatar:''},{id:'b',name:'Daniel Tan',initials:'DT',court:1,time:'8:00 pm',end:'9:00 pm',state:'confirmed',payment:'Paid',avatar:'lilac'},{id:'c',name:'Nadia Rahman',initials:'NR',court:3,time:'8:00 pm',end:'10:00 pm',state:'confirmed',payment:'Paid',avatar:'blue'},{id:'d',name:'Amir & friends',initials:'AF',court:1,time:'6:00 pm',end:'7:00 pm',state:'playing',payment:'Paid',avatar:'blue'},{id:'e',name:'Team Wednesday',initials:'TW',court:4,time:'6:00 pm',end:'7:30 pm',state:'playing',payment:'Paid',avatar:'lilac'}];
const sessions=[{court:1,start:1,length:1,label:'Amir & friends',kind:'blue',booking:'d'},{court:1,start:3,length:1,label:'Daniel Tan',kind:'',booking:'b'},{court:2,start:2,length:1,label:'Sarah Lim',kind:'amber',booking:'a'},{court:3,start:3,length:2,label:'Nadia Rahman',kind:'',booking:'c'},{court:4,start:1,length:1.5,label:'Team Wednesday',kind:'blue',booking:'e'},{court:6,start:0,length:6,label:'Court maintenance',kind:'gray',booking:null}];
function courtState(court){if(day===1)return court.state;if(court.id===6)return 'blocked';return day===0?'available':(court.id===2?'arriving':'available')}
function notify(text){clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').hidden=false;toastTimer=setTimeout(()=>{$('#toast').hidden=true},4200)}
function render(){
 const counts={available:0,playing:0,arriving:0,blocked:0};courts.forEach(c=>counts[courtState(c)]++);
 Object.entries(counts).forEach(([key,value])=>{$(`#${key}-count`).textContent=value});
 $$('.metric').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.filter===filter)));
 $('#day-label').textContent=day===1?'Today · 16 November':day===0?'Yesterday · 15 Nov':'Tomorrow · 17 Nov';
 $('#heading-time').parentElement.innerHTML=`${dates[day]} <span aria-hidden="true">·</span> <span id="heading-time">6:30 pm</span>`;
 $('#timeline-date').textContent=day===1?'Today':day===0?'Yesterday':'Tomorrow';$('#prev-day').disabled=day===0;$('#next-day').disabled=day===2;
 $('#filter-info').classList.toggle('visible',!!filter);$('#filter-label').textContent=filter?`${counts[filter]} ${stateLabels[filter].toLowerCase()} ${counts[filter]===1?'court':'courts'}`:'';
 $('#floor').innerHTML=courts.map(c=>{const s=courtState(c),dim=!!filter&&s!==filter;return `<button class="court${dim?' dimmed':''}" data-court="${c.id}" data-state="${s}" aria-label="Court ${String(c.id).padStart(2,'0')}, ${stateLabels[s]}${c.id===selected?', selected':''}" aria-pressed="${c.id===selected}"${dim?' tabindex="-1" aria-hidden="true"':''}><svg aria-hidden="true" viewBox="0 0 100 130"><use href="#court-lines"/></svg><span class="court-number">${String(c.id).padStart(2,'0')}</span>${s==='playing'?'<i class="player" aria-hidden="true"></i><i class="player second" aria-hidden="true"></i>':''}<span class="court-label">${s==='playing'?'In play':s==='arriving'?'7 pm arrival':s==='blocked'?'Maintenance':'Available'}</span></button>`}).join('');
 $$('[data-court]').forEach(button=>button.addEventListener('click',()=>{selected=Number(button.dataset.court);render();$('#selection-action').focus()}));
 const c=courts[selected-1],s=courtState(c);$('#selected-title').textContent=`Court ${String(c.id).padStart(2,'0')} ${s==='available'?'is ready':s==='playing'?'is in play':s==='arriving'?'has an arrival':'is under maintenance'}`;
 $('#selected-description').textContent=s==='available'?`Available until ${day===1?c.until:'10:00 pm'} · RM25 / hour`:s==='playing'?`${c.customer||'Sample session'} · Ends ${c.until}`:s==='arriving'?'Sarah Lim · 7:00–8:00 pm':'Net replacement · Reopens tomorrow';
 $('#selection-action').innerHTML=`${s==='available'?'Book this court':'View details'}${icon('arrow')}`;if(filter&&counts[filter]===0){$('#selected-title').textContent='No courts match this status';$('#selected-description').textContent='Try another status or show all courts.';$('#selection-action').innerHTML=`Show all courts ${icon('arrow')}`;}
 renderQueue();renderTimeline();syncVenue();
}
function renderQueue(){const upcomingCount=day===0?0:3,playingCount=day===1?2:0;$$('[data-queue]').forEach(button=>button.querySelector('b').textContent=button.dataset.queue==='upcoming'?upcomingCount:playingCount);$('#nav-booking-count').textContent=String(upcomingCount+playingCount);$('#queue-summary-label').textContent=day===1?'Today’s bookings':day===0?'Yesterday’s sample':'Tomorrow’s bookings';$('#queue-summary-value').textContent=`${playingCount} checked in · ${upcomingCount} to arrive`;const rows=day===0?[]:sampleBookings.filter(b=>queue==='upcoming'?b.state!=='playing':day===1&&b.state==='playing');$('#queue-list').innerHTML=rows.length?rows.map(b=>`<button class="queue-item" data-booking="${b.id}" aria-label="View ${b.name}, Court ${String(b.court).padStart(2,'0')}, ${b.time}"><span class="queue-avatar ${b.avatar}">${b.initials}</span><span class="queue-person"><strong>${b.name}</strong><span>Court ${String(b.court).padStart(2,'0')} · Badminton</span></span><span class="queue-time">${b.time}<small class="${b.payment==='Paid'?'green':''}">${b.payment}</small></span></button>`).join(''):'<div class="queue-empty">No upcoming arrivals for this sample day.</div>';$$('[data-booking]').forEach(button=>button.addEventListener('click',()=>openBooking(button.dataset.booking,button)))}
function renderTimeline(){const shown=allCourts?courts:courts.slice(0,4);$('#timeline-toggle').innerHTML=`${allCourts?'Show fewer':'All 6 courts'} ${icon('down')}`;$('#timeline-rows').innerHTML=shown.map(c=>`<div class="timeline-row"><span class="timeline-name"><i class="${courtState(c)==='playing'?'blue':''}"></i>Court ${String(c.id).padStart(2,'0')}</span><div class="timeline-track">${sessions.filter(s=>s.court===c.id&&(s.kind==='gray'||(day===1)||(day===2&&s.kind!=='blue'))).map(s=>`<button class="booking-block ${s.kind}" style="left:${s.start/6*100}%;width:calc(${s.length/6*100}% - 4px)" data-session="${s.booking||`court-${c.id}`}" aria-label="${s.label}, Court ${c.id}">${s.label}</button>`).join('')}</div></div>`).join('');$$('[data-session]').forEach(button=>button.addEventListener('click',()=>button.dataset.session.startsWith('court-')?openCourt(Number(button.dataset.session.split('-')[1]),button):openBooking(button.dataset.session,button)))}
function drawerBase(title,subtitle,content,action=''){$('#drawer-content').innerHTML=`<div class="drawer-top"><p class="eyebrow">SAMPLE BOOKING WORKSPACE</p><button class="icon-button" id="close-drawer" aria-label="Close details">${icon('x')}</button></div><h2 id="drawer-title">${title}</h2><p class="drawer-subtitle">${subtitle}</p>${content}<div class="sample-message">${icon('info')}<span>Design preview only. No reservation or payment will be saved.</span></div>${action}`;$('#close-drawer').addEventListener('click',closeDrawer);if(!$('#drawer').open)$('#drawer').showModal();$('#close-drawer').focus()}
function openCourt(id,opener){selected=id;if(filter&&courtState(courts[id-1])!==filter)filter="";render();drawerOpener=opener||document.activeElement;const c=courts[id-1],s=courtState(c);duration=60;time='6:30 pm';if(s!=='available'){drawerBase(`Court ${String(id).padStart(2,'0')}`,`Badminton · ${dates[day]}`,`<span class="detail-status ${s}">${stateLabels[s]}</span><div class="court-detail-art"><svg viewBox="0 0 100 130" aria-hidden="true"><use href="#court-lines"/></svg></div><dl class="detail-grid"><div><dt>${s==='blocked'?'Reason':'Customer'}</dt><dd>${s==='blocked'?'Net replacement':c.customer||'Sample session'}</dd></div><div><dt>${s==='blocked'?'Reopens':'Session ends'}</dt><dd>${c.until}</dd></div></dl><div class="drawer-section"><h3>Next step</h3><p class="drawer-subtitle">${s==='blocked'?'Choose another available court.':s==='arriving'?'Confirm the customer’s arrival at the front desk.':'View the session or choose another available court.'}</p></div>`,`<button class="button primary drawer-primary" id="find-another">Find an open court ${icon('arrow')}</button>`);$('#find-another').addEventListener('click',()=>{closeDrawer();setFilter('available');$('#court-map').scrollIntoView({behavior:'smooth',block:'start'})});return}
drawerBase(`Book Court ${String(id).padStart(2,'0')}`,`Badminton · ${dates[day]}`,`<span class="detail-status">Available ${day===1?'until '+c.until:'this evening'}</span><label class="drawer-label" for="sample-time">Choose a start time</label><select id="sample-time"><option>6:30 pm</option><option>7:00 pm</option>${id===5?'<option>7:30 pm</option><option>8:00 pm</option>':''}</select><span class="drawer-label">How long?</span><div class="choice-row" role="group" aria-label="Booking duration"><button data-duration="60" aria-pressed="true">1 hour</button><button data-duration="90" aria-pressed="false">1½ hours</button>${id===5?'<button data-duration="120" aria-pressed="false">2 hours</button>':''}</div><label class="drawer-label" for="sample-customer">Customer name</label><input id="sample-customer" placeholder="e.g. Alex Tan" autocomplete="off" maxlength="80"><dl class="detail-grid"><div><dt>Payment</dt><dd>Pay at venue</dd></div><div><dt>Sample price</dt><dd id="sample-price">RM25.00</dd></div></dl><div id="sample-result" aria-live="polite"></div>`,`<button class="button primary drawer-primary" id="preview-booking">Preview booking ${icon('arrow')}</button>`);
function syncChoices(){time=$('#sample-time').value;const limit=id===3?(time==='7:00 pm'?60:90):120;if(duration>limit)duration=limit;$$('[data-duration]').forEach(button=>{const value=Number(button.dataset.duration);button.disabled=value>limit;button.setAttribute('aria-pressed',String(value===duration));button.style.opacity=value>limit?'.4':'1'});$('#sample-price').textContent=`RM${(25*duration/60).toFixed(2)}`;$('#sample-result').innerHTML=''}
$('#sample-time').addEventListener('change',syncChoices);$$('[data-duration]').forEach(button=>button.addEventListener('click',()=>{duration=Number(button.dataset.duration);syncChoices()}));$('#sample-customer').addEventListener('input',()=>{$('#sample-result').innerHTML=''});$('#preview-booking').addEventListener('click',()=>{const name=$('#sample-customer').value.trim();if(name.length<2){$('#sample-result').innerHTML='<p class="drawer-success">Add a customer name to preview this booking.</p>';$('#sample-customer').focus();return}const result=document.createElement('div');result.className='drawer-success';result.textContent=`${name} · Court ${String(id).padStart(2,'0')} · ${time} · ${duration} min · RM${(25*duration/60).toFixed(2)}. This is a preview; nothing has been reserved.`;$('#sample-result').replaceChildren(result)})}
function openBooking(id,opener){const b=sampleBookings.find(item=>item.id===id);if(!b)return;drawerOpener=opener||document.activeElement;drawerBase(b.name,`Court ${String(b.court).padStart(2,'0')} · Badminton`, `<span class="detail-status ${b.state}">${b.state==='playing'?'Playing now':b.state==='arriving'?'Arriving soon':'Confirmed'}</span><div class="court-detail-art"><svg viewBox="0 0 100 130" aria-hidden="true"><use href="#court-lines"/></svg></div><dl class="detail-grid"><div><dt>Date</dt><dd>${dates[day].split(', ')[1]}</dd></div><div><dt>Time</dt><dd>${b.time}–${b.end}</dd></div><div><dt>Total</dt><dd>${b.id==='c'?'RM50.00':b.id==='e'?'RM37.50':'RM25.00'}</dd></div><div><dt>Payment</dt><dd>${b.payment}</dd></div></dl><div class="drawer-section"><h3>At the front desk</h3><p class="drawer-subtitle">${b.state==='playing'?'The session is underway. The court becomes available when this booking ends.':b.state==='arriving'?'Sarah is due at 7:00 pm. Check in the customer when they arrive.':'This booking is confirmed. Open the schedule to see what comes before and after.'}</p></div>`,`<button class="button primary drawer-primary" id="booking-next">${b.state==='arriving'?'Preview check-in':b.state==='playing'?'Preview session complete':'View on schedule'} ${icon('arrow')}</button>`);$('#booking-next').addEventListener('click',()=>{if(b.state==='confirmed'){closeDrawer();$('#timeline').scrollIntoView({behavior:'smooth',block:'start'});return}const old=$('.drawer-success');if(old)old.remove();const message=document.createElement('p');message.className='drawer-success';message.textContent=b.state==='arriving'?'This would mark Sarah as arrived. Preview only — no booking status changed.':'This would complete the session. Preview only — no booking status changed.';$('#booking-next').before(message)})}
function closeDrawer(){$('#drawer').close();if(drawerOpener?.isConnected)drawerOpener.focus();else $('#selection-action').focus()}
$('#drawer').addEventListener('cancel',event=>{event.preventDefault();closeDrawer()});$('#drawer').addEventListener('click',event=>{if(event.target===$('#drawer')){const bounds=$('#drawer').getBoundingClientRect();if(event.clientX<bounds.left||event.clientY<bounds.top||event.clientY>bounds.bottom)closeDrawer()}});
function setFilter(value){filter=value;const available=courts.filter(c=>!filter||courtState(c)===filter);if(available.length&&!available.some(c=>c.id===selected))selected=available[0].id;render()}
$$('[data-filter]').forEach(button=>button.addEventListener('click',()=>setFilter(filter===button.dataset.filter?'':button.dataset.filter)));$('#clear-filter').addEventListener('click',()=>setFilter(''));
$$('[data-view]').forEach(button=>button.addEventListener('click',()=>setMapView(button.dataset.view)));
$('#prev-day').addEventListener('click',()=>{day=Math.max(0,day-1);setFilter(filter)});$('#next-day').addEventListener('click',()=>{day=Math.min(2,day+1);setFilter(filter)});
$$('[data-queue]').forEach(button=>button.addEventListener('click',()=>{queue=button.dataset.queue;$$('[data-queue]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));renderQueue()}));
$('#selection-action').addEventListener('click',event=>{if(filter&&!courts.some(c=>courtState(c)===filter)){setFilter('');return}openCourt(selected,event.currentTarget)});$('#new-booking').addEventListener('click',event=>openCourt(courts.find(c=>courtState(c)==='available')?.id||3,event.currentTarget));$('#timeline-new').addEventListener('click',()=>{setFilter('available');$('#court-map').scrollIntoView({behavior:'smooth',block:'start'});$('#selection-action').focus()});
function toTimeline(){$('#timeline').scrollIntoView({behavior:'smooth',block:'start'});$('#timeline-toggle').focus()};$('#schedule-jump').addEventListener('click',toTimeline);$('#all-bookings').addEventListener('click',toTimeline);$('#timeline-toggle').addEventListener('click',()=>{allCourts=!allCourts;renderTimeline()});
$('#venue-switch').addEventListener('click',()=>notify('This preview shows the sample Main venue. Venue switching stays in the same familiar place.'));
$('.mobile-menu').addEventListener('click',()=>{const open=$('#sidebar').classList.toggle('mobile-open');$('.mobile-menu').setAttribute('aria-expanded',String(open));$('.mobile-menu').setAttribute('aria-label',open?'Close navigation':'Open navigation')});
$$('[data-nav]').forEach(link=>link.addEventListener('click',event=>{$$('[data-nav]').forEach(item=>item.classList.toggle('active',item===link));$('#sidebar').classList.remove('mobile-open');$('.mobile-menu').setAttribute('aria-expanded','false');$('.mobile-menu').setAttribute('aria-label','Open navigation');if(link.dataset.nav==='settings'){event.preventDefault();notify('Settings remain in the existing workspace. This preview focuses on everyday booking tasks.')}if(link.dataset.nav==='payments'){queue='upcoming';$$('[data-queue]').forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.queue===queue)));renderQueue();notify('Sarah’s sample booking is pay at venue. Open her card to view its balance.')}}));
function closeSearch(){$('#search-dialog').close();if(searchOpener?.isConnected)searchOpener.focus()}
function renderSearch(){const term=$('#quick-search').value.toLowerCase().trim();const courtMatches=courts.filter(c=>`court ${c.id} court ${String(c.id).padStart(2,'0')} badminton ${stateLabels[courtState(c)]}`.toLowerCase().includes(term));const bookingMatches=sampleBookings.filter(b=>b.name.toLowerCase().includes(term));$('#search-results').innerHTML=[...courtMatches.map(c=>`<button data-search-court="${c.id}">${icon('court')}<span>Court ${String(c.id).padStart(2,'0')} · ${stateLabels[courtState(c)]}</span></button>`),...bookingMatches.map(b=>`<button data-search-booking="${b.id}">${icon('users')}<span>${b.name} · ${b.time}</span></button>`)].join('')||'<div class="queue-empty">No sample courts or customers match.</div>';$$('[data-search-court]').forEach(button=>button.addEventListener('click',()=>{const id=Number(button.dataset.searchCourt);closeSearch();openCourt(id,$('.search-launch'))}));$$('[data-search-booking]').forEach(button=>button.addEventListener('click',()=>{const id=button.dataset.searchBooking;closeSearch();openBooking(id,$('.search-launch'))}))}
function openSearch(){if($('#drawer').open||$('#venue-dialog').open)return;searchOpener=document.activeElement;$('#quick-search').value='';renderSearch();$('#search-dialog').showModal();$('#quick-search').focus()};$('.search-launch').addEventListener('click',openSearch);$('#quick-search').addEventListener('input',renderSearch);$('#close-search').addEventListener('click',closeSearch);$('#search-dialog').addEventListener('cancel',event=>{event.preventDefault();closeSearch()});document.addEventListener('keydown',event=>{if(event.isComposing)return;if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if($('#search-dialog').open)closeSearch();else openSearch()}if(event.key==='Escape'&&$('#sidebar').classList.contains('mobile-open')){$('#sidebar').classList.remove('mobile-open');$('.mobile-menu').setAttribute('aria-expanded','false');$('.mobile-menu').setAttribute('aria-label','Open navigation');$('.mobile-menu').focus()}});

function selectVenueCourt(id){
 const court=courts.find(item=>item.id===id);
 if(!court||(filter&&courtState(court)!==filter))return;
 selected=id;render();
 const button=$('[data-select-court="'+id+'"]');
 if(mapView==='3d'&&button)button.focus({preventScroll:true});
}
function syncVenue(){
 const states=courts.map(c=>({id:c.id,state:courtState(c),selected:c.id===selected,visible:!filter||courtState(c)===filter}));
 $('#court-status-list').innerHTML=states.map(c=>'<button type="button" data-select-court="'+c.id+'" data-state="'+c.state+'" aria-pressed="'+c.selected+'"'+(!c.visible?' hidden':'')+'><span class="court-status-number">'+String(c.id).padStart(2,'0')+'</span><span class="court-status-text"><strong>Court '+String(c.id).padStart(2,'0')+'</strong><small><i></i>'+stateLabels[c.state]+'</small></span><svg class="court-selected-check" aria-hidden="true"><use href="#check"/></svg></button>').join('');
 venueScene?.updateCourts(states);
}
function setMapView(view){
 mapView=view==='3d'&&venueScene?'3d':'flat';
 $('#map-scene').classList.toggle('flat',mapView==='flat');
 $('#court-map').classList.toggle('flat-view',mapView==='flat');
 $$('[data-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===mapView)));
 $('#venue-hint').textContent=mapView==='3d'?(window.matchMedia('(pointer: coarse)').matches?'Use arrows to rotate · tap a court':'Drag to explore · tap a court'):'Tap a court to select';
 venueScene?.setActive(mapView==='3d');
}
function closeVenue(){
 if(!$('#venue-dialog').open)return;
 $('#venue-dialog').close();
 mapAnchor?.replaceWith($('#court-map'));mapAnchor=null;
 $('#expand-venue').focus({preventScroll:true});
}
$('#court-status-list').addEventListener('click',event=>{
 const button=event.target.closest('[data-select-court]');
 if(button)selectVenueCourt(Number(button.dataset.selectCourt));
});
$$('[data-camera]').forEach(button=>button.addEventListener('click',()=>{
 if(!venueScene)return;
 const action=button.dataset.camera;
 if(action==='reset')venueScene.resetView();
 else if(action==='in'||action==='out')venueScene.zoom(action==='in'?1:-1);
 else venueScene.rotate(action==='left'?-1:1);
}));
$('#expand-venue').addEventListener('click',()=>{
 const panel=$('#court-map');mapAnchor=document.createElement('div');
 panel.before(mapAnchor);$('#venue-dialog').append(panel);$('#venue-dialog').showModal();
 $('#collapse-venue').focus();
});
$('#collapse-venue').addEventListener('click',closeVenue);
$('#venue-dialog').addEventListener('cancel',event=>{event.preventDefault();closeVenue()});
$('#venue-dialog').addEventListener('click',event=>{if(event.target===$('#venue-dialog'))closeVenue()});
function fallbackVenue(){
 venueScene?.dispose();venueScene=null;
 $('#court-map').classList.remove('has-3d');
 $('#venue-fallback').hidden=false;
 const toggle=$('[data-view="3d"]');toggle.disabled=true;toggle.title='3D is unavailable in this browser';
 setMapView('flat');
}
try{
 if(!window.SlotraVenue3D)throw new Error('3D renderer unavailable');
 venueScene=window.SlotraVenue3D.createVenueScene($('#venue-canvas'),{onSelect:selectVenueCourt,onError:fallbackVenue});
 $('#court-map').classList.add('has-3d');setMapView('3d');
}catch{fallbackVenue()}
window.addEventListener('pagehide',event=>{if(event.persisted)venueScene?.setActive(false);else venueScene?.dispose()});
window.addEventListener('pageshow',()=>venueScene?.setActive(mapView==='3d'));

render();
})();
