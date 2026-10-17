codeunit 86801 "HX067 Checkout Refusal"
{
    EventSubscriberInstance = Manual;

    var
        RefusedVehicleNo: Code[20];
        RefusedErr: Label 'HX067 checkout refused for %1.', Comment = '%1 = vehicle number', Locked = true;

    procedure SetRefusedVehicle(VehicleNo: Code[20])
    begin
        RefusedVehicleNo := VehicleNo;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Core Events", 'OnAfterVehicleCheckedOut', '', false, false)]
    local procedure HX67RefuseCheckout(VehicleNo: Code[20])
    begin
        if (RefusedVehicleNo <> '') and (VehicleNo = RefusedVehicleNo) then
            Error(RefusedErr, VehicleNo);
    end;
}
