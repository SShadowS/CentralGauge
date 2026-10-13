codeunit 86703 "HX062 Endpoint"
{
    EventSubscriberInstance = Manual;

    var
        RejectedVehicleNo: Code[20];
        RejectedErr: Label 'Endpoint rejected vehicle %1.', Comment = '%1 = vehicle number';

    procedure RejectVehicle(VehicleNo: Code[20])
    begin
        RejectedVehicleNo := VehicleNo;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Outbox Dispatcher", 'OnSendEntry', '', false, false)]
    local procedure DeliverOutboxEntry(Entry: Record "CGR Outbox Entry"; var Delivered: Boolean)
    begin
        if (RejectedVehicleNo <> '') and (Entry."Vehicle No." = RejectedVehicleNo) then
            Error(RejectedErr, Entry."Vehicle No.");
        Delivered := true;
    end;
}
