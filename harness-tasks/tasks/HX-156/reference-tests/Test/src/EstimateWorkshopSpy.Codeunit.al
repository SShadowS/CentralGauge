codeunit 80631 "CGR Estimate Workshop Spy"
{
    EventSubscriberInstance = Manual;

    var
        RefusedVehicleNo: Code[20];
        WorkshopRefusedErr: Label 'The workshop app refused the estimate of vehicle %1.', Comment = '%1 = vehicle number';

    procedure RefuseEstimateOf(VehicleNo: Code[20])
    begin
        RefusedVehicleNo := VehicleNo;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Repair Estimate Apply", 'OnAfterEstimateApplied', '', false, false)]
    local procedure RefuseAppliedEstimate(VehicleNo: Code[20]; Total: Decimal)
    begin
        if VehicleNo = RefusedVehicleNo then
            Error(WorkshopRefusedErr, VehicleNo);
    end;
}
