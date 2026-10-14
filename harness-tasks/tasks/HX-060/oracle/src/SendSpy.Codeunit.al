codeunit 86661 "HX060 Send Spy"
{
    EventSubscriberInstance = Manual;

    var
        SentEntryNos: List of [Integer];
        RejectedVehicleNo: Code[20];
        RejectedErr: Label 'Endpoint rejected vehicle %1.', Comment = '%1 = vehicle number';

    procedure RejectVehicle(VehicleNo: Code[20])
    begin
        RejectedVehicleNo := VehicleNo;
    end;

    procedure CallCount(): Integer
    begin
        exit(SentEntryNos.Count());
    end;

    procedure CallAt(Index: Integer): Integer
    begin
        exit(SentEntryNos.Get(Index));
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Outbox Dispatcher", 'OnSendEntry', '', false, false)]
    local procedure DeliverEntry(Entry: Record "CGR Outbox Entry"; var Delivered: Boolean)
    begin
        SentEntryNos.Add(Entry."Entry No.");
        if (RejectedVehicleNo <> '') and (Entry."Vehicle No." = RejectedVehicleNo) then
            Error(RejectedErr, Entry."Vehicle No.");
        Delivered := true;
    end;
}
