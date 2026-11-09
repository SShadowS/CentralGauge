codeunit 80637 "CGR Estimate Refusal Spy"
{
    EventSubscriberInstance = Manual;

    var
        ResultOnlyRefusedNo: Code[20];
        ResultOnlyRefusedErr: Label 'Workshop refused %1.', Comment = '%1 = vehicle number';

    procedure RefuseResultOnlyEstimate(VehicleNo: Code[20])
    begin
        ResultOnlyRefusedNo := VehicleNo;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Repair Estimate Apply", 'OnAfterEstimateApplied', '', false, false)]
    local procedure RefuseResultOnlyApplied(VehicleNo: Code[20]; Total: Decimal)
    begin
        if VehicleNo = ResultOnlyRefusedNo then
            Error(ResultOnlyRefusedErr, VehicleNo);
    end;
}
