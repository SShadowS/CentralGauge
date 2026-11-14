codeunit 70127 "CGR Vehicle Audit Check"
{
    TableNo = "CGR Fleet Audit Finding";

    var
        NoDescriptionErr: Label 'Vehicle %1 has an open damage without a description.', Comment = '%1 = vehicle number';
        OpenDamageTxt: Label 'Open damage reported on %1: %2', Comment = '%1 = report date, %2 = damage description';

    trigger OnRun()
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        VehicleNo: Code[20];
        AuditDate: Date;
        LineNo: Integer;
    begin
        VehicleNo := Rec."Vehicle No.";
        AuditDate := Rec."Audit Date";
        Vehicle.Get(VehicleNo);
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.SetRange(Repaired, false);
        DamageEntry.SetRange("Reported On", 0D, AuditDate);
        if DamageEntry.FindSet() then
            repeat
                if DamageEntry.Description = '' then
                    Error(NoDescriptionErr, VehicleNo);
                LineNo += 10000;
                Rec.Init();
                Rec."Vehicle No." := VehicleNo;
                Rec."Line No." := LineNo;
                Rec."Audit Date" := AuditDate;
                Rec.Finding := StrSubstNo(OpenDamageTxt, Format(DamageEntry."Reported On", 0, 9), DamageEntry.Description);
                Rec."Check Failed" := false;
                Rec.Insert();
            until DamageEntry.Next() = 0;
    end;
}
