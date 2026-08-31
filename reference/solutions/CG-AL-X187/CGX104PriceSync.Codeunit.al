codeunit 70642 "CG X104 Price Sync"
{
    procedure SyncPriceList(ListCode: Code[20]; Payload: Text)
    var
        List: Record "CG X104 Price List";
        Line: Record "CG X104 Price List Line";
        StagingLine: Record "CG X104 Price List Line" temporary;
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

        // Parse and validate every entry into a staging buffer before
        // touching any existing data, so a response that turns out to carry
        // nothing usable never gets the chance to replace anything.
        LineNo := 0;
        for Idx := 0 to ItemsArray.Count() - 1 do begin
            ItemsArray.Get(Idx, ItemToken);
            ItemObj := ItemToken.AsObject();
            LineNo += 10000;

            StagingLine.Init();
            StagingLine."List Code" := ListCode;
            StagingLine."Line No." := LineNo;

            if not ItemObj.Get('itemNo', FieldToken) then
                Error('An item in the feed for %1 is missing an item number.', ListCode);
            StagingLine."Item No." := CopyStr(FieldToken.AsValue().AsText(), 1, MaxStrLen(StagingLine."Item No."));

            if not ItemObj.Get('unitPrice', FieldToken) then
                Error('Item %1 in the feed for %2 is missing a unit price.', StagingLine."Item No.", ListCode);
            StagingLine."Unit Price" := FieldToken.AsValue().AsDecimal();

            StagingLine.Insert();
        end;

        NewCount := StagingLine.Count();
        if NewCount = 0 then
            Error('The price feed for %1 returned no items; the existing price list was left unchanged.', ListCode);

        Line.SetRange("List Code", ListCode);
        Line.DeleteAll();

        if StagingLine.FindSet() then
            repeat
                Line.Init();
                Line."List Code" := StagingLine."List Code";
                Line."Line No." := StagingLine."Line No.";
                Line."Item No." := StagingLine."Item No.";
                Line."Unit Price" := StagingLine."Unit Price";
                Line.Insert();
            until StagingLine.Next() = 0;

        List."Line Count" := NewCount;
        List.Modify();
    end;
}
