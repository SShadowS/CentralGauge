codeunit 70402 "CGR Integration Subscribers"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Core Events", 'OnAfterVehicleCheckedOut', '', false, false)]
    local procedure QueueCheckout(VehicleNo: Code[20])
    var
        Facade: Codeunit "CGR Integration Facade";
    begin
        Facade.QueueVehicleCheckedOut(VehicleNo);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Core Events", 'OnAfterVehicleReturned', '', false, false)]
    local procedure QueueReturn(VehicleNo: Code[20]; ReturnKm: Integer; DamageDescription: Text[100])
    var
        Facade: Codeunit "CGR Integration Facade";
    begin
        Facade.QueueVehicleReturned(VehicleNo, ReturnKm, DamageDescription);
    end;
}
