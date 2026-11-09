codeunit 80633 "CGR Estimate One Line Spy"
{
    EventSubscriberInstance = Manual;

    var
        OneLineRefusedNo: Code[20];
        OneLineRefusedErr: Label 'Workshop refused %1.', Comment = '%1 = vehicle number';

    procedure RefuseOneLineEstimate(VehicleNo: Code[20])
    begin
        OneLineRefusedNo := VehicleNo;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Repair Estimate Apply", 'OnAfterEstimateApplied', '', false, false)]
    local procedure RefuseOneLineApplied(VehicleNo: Code[20]; Total: Decimal)
    begin
        if VehicleNo = OneLineRefusedNo then
            Error(OneLineRefusedErr, VehicleNo);
    end;
}
