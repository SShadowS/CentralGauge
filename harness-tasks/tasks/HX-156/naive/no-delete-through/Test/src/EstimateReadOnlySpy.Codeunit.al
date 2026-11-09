codeunit 80635 "CGR Estimate Read Only Spy"
{
    EventSubscriberInstance = Manual;

    var
        ReadOnlyRefusedNo: Code[20];
        ReadOnlyRefusedErr: Label 'Workshop refused %1.', Comment = '%1 = vehicle number';

    procedure RefuseReadOnlyEstimate(VehicleNo: Code[20])
    begin
        ReadOnlyRefusedNo := VehicleNo;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Repair Estimate Apply", 'OnAfterEstimateApplied', '', false, false)]
    local procedure RefuseReadOnlyApplied(VehicleNo: Code[20]; Total: Decimal)
    begin
        if VehicleNo = ReadOnlyRefusedNo then
            Error(ReadOnlyRefusedErr, VehicleNo);
    end;
}
