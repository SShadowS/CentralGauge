codeunit 70402 "CGR Integration Subscribers"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Core Events", 'OnAfterVehicleCheckedOut', '', false, false)]
    local procedure QueueCheckout(VehicleNo: Code[20])
    var
        Facade: Codeunit "CGR Integration Facade";
    begin
        Facade.QueueVehicleCheckedOut(VehicleNo);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Core Events", 'OnAfterVehicleNoChanged', '', false, false)]
    local procedure MoveOutboxEntries(OldVehicleNo: Code[20]; NewVehicleNo: Code[20])
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.SetRange("Vehicle No.", OldVehicleNo);
        Entry.SetRange(Sent, false);
        Entry.ModifyAll("Vehicle No.", NewVehicleNo);
    end;
}
