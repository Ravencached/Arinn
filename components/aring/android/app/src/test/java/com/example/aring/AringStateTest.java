package com.example.aring;
import org.junit.Test;
import static org.junit.Assert.*;
import org.json.*;
public class AringStateTest {
    JSONObject item(String title,int revision)throws Exception{return new JSONObject().put("id","event-123").put("calendarId","private-123").put("title",title).put("revision",revision);}
    JSONObject state()throws Exception{return AringState.empty().put("user",new JSONObject().put("id","user-123")).put("calendars",new JSONArray().put(new JSONObject().put("id","private-123").put("role","editor"))).put("items",new JSONArray().put(item("Original",1)));}
    JSONObject mutation(String title)throws Exception{return new JSONObject().put("itemId","event-123").put("action","put").put("item",item(title,1));}
    JSONObject response(JSONObject state,JSONArray items,JSONArray results)throws Exception{return new JSONObject().put("user",state.getJSONObject("user")).put("calendars",state.getJSONArray("calendars")).put("items",items).put("results",results);}
    @Test public void inFlightEditIsRebasedOnAcknowledgement()throws Exception{
        JSONObject s=AringState.mutateValue(state(),mutation("First"));JSONArray sent=new JSONArray(s.getJSONArray("pending").toString());s.put("inFlight",sent);
        s=AringState.mutateValue(s,mutation("Latest"));
        s=AringState.mergeValue(s,response(s,new JSONArray().put(item("First",2)),new JSONArray().put(new JSONObject().put("opId",sent.getJSONObject(0).getString("opId")).put("status","ok").put("revision",2))),sent,"user-123");
        assertEquals(2,s.getJSONArray("pending").getJSONObject(0).getInt("baseRevision"));assertEquals("Latest",s.getJSONArray("items").getJSONObject(0).getString("title"));
    }
    @Test public void deleteDuringCreateDoesNotResurrect()throws Exception{
        JSONObject s=state().put("items",new JSONArray());s=AringState.mutateValue(s,mutation("New"));JSONArray sent=new JSONArray(s.getJSONArray("pending").toString());s.put("inFlight",sent);
        s=AringState.mutateValue(s,new JSONObject().put("itemId","event-123").put("action","delete"));
        assertEquals(1,s.getJSONArray("pending").length());
        s=AringState.mergeValue(s,response(s,new JSONArray().put(item("New",1)),new JSONArray().put(new JSONObject().put("opId",sent.getJSONObject(0).getString("opId")).put("status","ok").put("revision",1))),sent,"user-123");
        assertEquals(0,s.getJSONArray("items").length());assertEquals(1,s.getJSONArray("pending").getJSONObject(0).getInt("baseRevision"));
    }
    @Test public void staleEditorKeepsItsBaseRevision()throws Exception{JSONObject s=state().put("items",new JSONArray().put(item("Server",2)));s=AringState.mutateValue(s,mutation("Old editor").put("baseRevision",1));assertEquals(1,s.getJSONArray("pending").getJSONObject(0).getInt("baseRevision"));}
    @Test public void revokedMembershipClearsCachedSharedData()throws Exception{JSONObject s=AringState.mutateValue(state(),mutation("Offline"));JSONObject response=response(s,new JSONArray(),new JSONArray()).put("calendars",new JSONArray());s=AringState.mergeValue(s,response,new JSONArray(),"user-123");assertEquals(0,s.getJSONArray("pending").length());assertEquals(0,s.getJSONArray("items").length());}
    @Test public void deniedOfflineWorkProducesVisibleAccessWarning()throws Exception{JSONObject s=AringState.mutateValue(state(),mutation("Offline"));JSONArray sent=new JSONArray(s.getJSONArray("pending").toString());JSONObject response=response(s,new JSONArray(),new JSONArray().put(new JSONObject().put("opId",sent.getJSONObject(0).getString("opId")).put("status","denied"))).put("calendars",new JSONArray());s=AringState.mergeValue(s,response,sent,"user-123");assertTrue(s.getString("status").startsWith("Access changed"));assertEquals(0,s.getJSONArray("pending").length());}
    @Test public void conflictRetainsLatestLocalDraft()throws Exception{
        JSONObject s=AringState.mutateValue(state(),mutation("First"));JSONArray sent=new JSONArray(s.getJSONArray("pending").toString());s=AringState.mutateValue(s,mutation("Latest"));
        s=AringState.mergeValue(s,response(s,new JSONArray().put(item("Server",2)),new JSONArray().put(new JSONObject().put("opId",sent.getJSONObject(0).getString("opId")).put("status","conflict").put("current",item("Server",2)))),sent,"user-123");
        assertEquals(0,s.getJSONArray("pending").length());assertEquals("Latest",s.getJSONArray("conflicts").getJSONObject(0).getJSONObject("local").getJSONObject("item").getString("title"));
    }
}
