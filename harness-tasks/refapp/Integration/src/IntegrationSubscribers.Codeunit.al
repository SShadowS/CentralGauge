codeunit 70402 "CGR Integration Subscribers"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Core Events", 'OnAfterVehicleCheckedOut', '', false, false)]
    local procedure QueueCheckout(VehicleNo: Code[20])
    var
        Facade: Codeunit "CGR Integration Facade";
    begin
        Facade.QueueVehicleCheckedOut(VehicleNo);
    end;
}
