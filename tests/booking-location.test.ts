import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBookingLocation } from '../shared/booking-location';
import { parsePublicDraftValues, readPublicDraft, savePublicDraft } from '../lib/shared/request-draft';
import { parseBooking, readBooking, saveBooking, BOOKING_DRAFT_KEY } from '../components/app/booking-draft';
import { bookingFromSignedRequest } from '../components/app/signed-booking';
const location = { latitude: 14.61, longitude: -61.07, access_details: 'Entrée cour (démonstration)' };
test('location validates paired bounded finite coordinates and private access text', () => {
 assert.deepEqual(parseBookingLocation(location),location);
 assert.deepEqual(parseBookingLocation({...location,latitude:null,longitude:null}),{...location,latitude:null,longitude:null});
 for(const bad of [{...location,latitude:NaN},{...location,latitude:91},{...location,longitude:181},{...location,latitude:null},{...location,access_details:'a'.repeat(1001)},{...location,actor:'other'}]) assert.equal(parseBookingLocation(bad),null);
});
test('public and signed drafts retain location on reload; legacy remains valid', () => {
 const values = parsePublicDraftValues({category:'socket',address:'Adresse QA',postal_code:'97200',city:'Commune QA',location})!;
 assert.deepEqual(values.location,location);
 const store = new Map<string,string>(); const storage = {getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>{store.set(k,v)}};
 assert.equal(savePublicDraft(storage,values).ok,true);
 assert.deepEqual(readPublicDraft(store.get('courant-request-draft'))?.values.location,location);
 const booking = bookingFromSignedRequest(values,null);
 assert.deepEqual(booking.location,location);
 assert.equal(saveBooking(storage,booking),true);
 assert.deepEqual(readBooking(store.get(BOOKING_DRAFT_KEY))?.booking.location,location);
 const {location:_,...legacy}=booking; assert.ok(parseBooking(legacy));
 assert.equal(parsePublicDraftValues({...values,location:{...location,latitude:null}}),null);
});
