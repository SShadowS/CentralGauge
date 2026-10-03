codeunit 85841 "HX019 Price Extension"
{
    EventSubscriberInstance = Manual;

    var
        TargetContractNo: Code[20];
        MarkerVehicleNo: Code[20];
        LinesSeen: Integer;

    procedure AddInsuranceTo(ContractNo: Code[20])
    begin
        TargetContractNo := ContractNo;
    end;

    procedure CommitWithMarker(VehicleNo: Code[20])
    begin
        MarkerVehicleNo := VehicleNo;
    end;

    procedure LinesSeenOnEntry(): Integer
    begin
        exit(LinesSeen);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Rental Pricing", 'OnAfterCalcLines', '', false, false)]
    local procedure HandleAfterCalcLines(Contract: Record "CGR Rental Contract"; var PriceLine: Record "CGR Invoice Preview Line")
    var
        Vehicle: Record "CGR Vehicle";
        LineNo: Integer;
    begin
        if (TargetContractNo = '') or (Contract."No." <> TargetContractNo) then
            exit;
        LinesSeen := PriceLine.Count();
        if MarkerVehicleNo <> '' then begin
            Vehicle.Init();
            Vehicle."No." := MarkerVehicleNo;
            Vehicle.Description := 'HX019 extension marker';
            Vehicle.Insert();
            Commit();
        end;
        if PriceLine.FindLast() then
            LineNo := PriceLine."Line No.";
        PriceLine.Init();
        PriceLine."Line No." := LineNo + 10000;
        PriceLine."Contract No." := Contract."No.";
        PriceLine.Description := 'Insurance';
        PriceLine.Quantity := 1;
        PriceLine."Unit Price" := 10;
        PriceLine.Insert(true);
    end;
}
