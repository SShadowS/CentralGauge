codeunit 86701 "HX062 Outcome Guard"
{
    EventSubscriberInstance = Manual;

    var
        GuardedVehicleNo: Code[20];
        RefusedErr: Label 'HX062 outcome refused for %1.', Comment = '%1 = vehicle number';

    procedure GuardVehicle(VehicleNo: Code[20])
    begin
        GuardedVehicleNo := VehicleNo;
    end;

    [EventSubscriber(ObjectType::Table, Database::"CGR Outbox Entry", 'OnAfterModifyEvent', '', false, false)]
    local procedure RefuseSentOutcome(var Rec: Record "CGR Outbox Entry"; var xRec: Record "CGR Outbox Entry"; RunTrigger: Boolean)
    begin
        if Rec.IsTemporary() then
            exit;
        if (GuardedVehicleNo <> '') and (Rec."Vehicle No." = GuardedVehicleNo) and Rec.Sent then
            Error(RefusedErr, Rec."Vehicle No.");
    end;
}
