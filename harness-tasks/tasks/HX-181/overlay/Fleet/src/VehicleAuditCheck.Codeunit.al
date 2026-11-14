codeunit 70127 "CGR Vehicle Audit Check"
{
    TableNo = "CGR Fleet Audit Finding";

    var
        ServiceAboveMileageErr: Label 'Vehicle %1 shows a last service at %2 km, above its mileage of %3 km.', Comment = '%1 = vehicle number, %2 = last service km, %3 = mileage';

    trigger OnRun()
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        VehicleNo: Code[20];
        AuditDate: Date;
    begin
        VehicleNo := Rec."Vehicle No.";
        AuditDate := Rec."Audit Date";
        Vehicle.Get(VehicleNo);
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.SetRange(Repaired, false);
        DamageEntry.SetRange("Reported On", 0D, AuditDate);
        if DamageEntry.FindSet() then
            repeat
                Rec.Init();
                Rec."Damage Entry No." := DamageEntry."Entry No.";
                Rec."Vehicle No." := VehicleNo;
                Rec."Reported On" := DamageEntry."Reported On";
                Rec.Description := DamageEntry.Description;
                Rec."Audit Date" := AuditDate;
                Rec.Insert();
            until DamageEntry.Next() = 0;
        VerifyServiceRecord(Vehicle);
    end;

    local procedure VerifyServiceRecord(Vehicle: Record "CGR Vehicle")
    begin
        if Vehicle."Last Service Km" > Vehicle.Mileage then
            Error(ServiceAboveMileageErr, Vehicle."No.", Format(Vehicle."Last Service Km", 0, 9), Format(Vehicle.Mileage, 0, 9));
    end;
}
