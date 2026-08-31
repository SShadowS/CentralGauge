codeunit 70642 "CG X104 Price Sync"
{
    procedure SyncPriceList(ListCode: Code[20]; Payload: Text)
    var
        List: Record "CG X104 Price List";
        Line: Record "CG X104 Price List Line";
        PayloadJson: JsonObject;
        ItemsToken: JsonToken;
        ItemsArray: JsonArray;
        ItemToken: JsonToken;
        ItemObj: JsonObject;
        FieldToken: JsonToken;
        LineNo: Integer;
        NewCount: Integer;
        Idx: Integer;
    begin
        if not List.Get(ListCode) then
            Error('Unknown price list %1.', ListCode);

        if not PayloadJson.ReadFrom(Payload) then
            Error('The price feed response for %1 could not be read.', ListCode);
        if not PayloadJson.Get('items', ItemsToken) then
            Error('The price feed response for %1 is missing an items list.', ListCode);
        if not ItemsToken.IsArray() then
            Error('The price feed response for %1 has an items list of the wrong shape.', ListCode);
        ItemsArray := ItemsToken.AsArray();

        // The feed's response has the shape we expect, so replace the list's
        // current contents with whatever it sent.
        Line.SetRange("List Code", ListCode);
        Line.DeleteAll();
        List."Line Count" := 0;
        List.Modify();

        LineNo := 0;
        NewCount := 0;
        for Idx := 0 to ItemsArray.Count() - 1 do begin
            ItemsArray.Get(Idx, ItemToken);
            ItemObj := ItemToken.AsObject();
            LineNo += 10000;

            Line.Init();
            Line."List Code" := ListCode;
            Line."Line No." := LineNo;

            if not ItemObj.Get('itemNo', FieldToken) then
                Error('An item in the feed for %1 is missing an item number.', ListCode);
            Line."Item No." := CopyStr(FieldToken.AsValue().AsText(), 1, MaxStrLen(Line."Item No."));

            if not ItemObj.Get('unitPrice', FieldToken) then
                Error('Item %1 in the feed for %2 is missing a unit price.', Line."Item No.", ListCode);
            Line."Unit Price" := FieldToken.AsValue().AsDecimal();

            Line.Insert();
            NewCount += 1;
        end;

        List."Line Count" := NewCount;
        List.Modify();
    end;
}
