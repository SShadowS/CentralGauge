codeunit 86581 "HX056 Queue Spy"
{
    EventSubscriberInstance = Manual;

    var
        RefusedVehicles: List of [Code[20]];
        Numbers: List of [BigInteger];
        EntryNos: List of [Integer];
        StoredFlags: List of [Boolean];
        PayloadNumbers: List of [BigInteger];
        RefusedErr: Label 'HX056 partner refused %1.', Comment = '%1 = vehicle number';

    procedure Refuse(VehicleNo: Code[20])
    begin
        RefusedVehicles.Add(VehicleNo);
    end;

    procedure Calls(): Integer
    begin
        exit(Numbers.Count());
    end;

    procedure NumberAt(Index: Integer): BigInteger
    begin
        exit(Numbers.Get(Index));
    end;

    procedure EntryNoAt(Index: Integer): Integer
    begin
        exit(EntryNos.Get(Index));
    end;

    procedure StoredAt(Index: Integer): Boolean
    begin
        exit(StoredFlags.Get(Index));
    end;

    procedure PayloadNumberAt(Index: Integer): BigInteger
    begin
        exit(PayloadNumbers.Get(Index));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Integration Facade", 'OnAfterQueueEntry', '', false, false)]
    local procedure RecordQueuedEntry(var Entry: Record "CGR Outbox Entry")
    var
        StoredEntry: Record "CGR Outbox Entry";
        Payload: JsonObject;
        Token: JsonToken;
        PayloadNo: BigInteger;
        Stored: Boolean;
    begin
        Stored := false;
        if Entry."Entry No." <> 0 then
            if StoredEntry.Get(Entry."Entry No.") then
                Stored := StoredEntry."Correlation No." = Entry."Correlation No.";
        PayloadNo := -1;
        if Payload.ReadFrom(Entry.Payload) then
            if Payload.Get('correlationNo', Token) then
                if Token.IsValue() then
                    PayloadNo := Token.AsValue().AsBigInteger();
        Numbers.Add(Entry."Correlation No.");
        EntryNos.Add(Entry."Entry No.");
        StoredFlags.Add(Stored);
        PayloadNumbers.Add(PayloadNo);
        if RefusedVehicles.Contains(Entry."Vehicle No.") then
            Error(RefusedErr, Entry."Vehicle No.");
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Outbox Dispatcher", 'OnSendEntry', '', false, false)]
    local procedure DeliverEntry(Entry: Record "CGR Outbox Entry"; var Delivered: Boolean)
    begin
        Delivered := true;
    end;
}
