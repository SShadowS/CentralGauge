codeunit 70131 "CGR Repair Estimate Apply"
{
    TableNo = "CGR Repair Estimate Line";

    var
        ApplyVehicleNo: Code[20];

    procedure SetApplyVehicle(VehicleNo: Code[20])
    begin
        ApplyVehicleNo := VehicleNo;
    end;

    trigger OnRun()
    var
        Approved: Record "CGR Repair Estimate Line";
        Total: Decimal;
    begin
        Rec.SetRange("Vehicle No.", ApplyVehicleNo);
        if Rec.FindSet() then
            repeat
                Approved.Init();
                Approved."Entry No." := 0;
                Approved."Vehicle No." := Rec."Vehicle No.";
                Approved."Line No." := Rec."Line No.";
                Approved.Description := Rec.Description;
                Approved.Amount := Rec.Amount;
                Approved.Insert(true);
                Total += Rec.Amount;
            until Rec.Next() = 0;
        OnAfterEstimateApplied(ApplyVehicleNo, Total);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterEstimateApplied(VehicleNo: Code[20]; Total: Decimal)
    begin
    end;
}
