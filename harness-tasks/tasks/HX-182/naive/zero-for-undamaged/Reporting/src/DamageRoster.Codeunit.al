codeunit 70597 "CGR Damage Roster"
{
    procedure FillRoster(var Buffer: Record "CGR Damage Roster Buffer" temporary)
    var
        Roster: Query "CGR Vehicle Damage Roster";
    begin
        Buffer.Reset();
        Buffer.DeleteAll();
        Roster.Open();
        while Roster.Read() do begin
            Buffer.Init();
            Buffer."Vehicle No." := Roster.VehicleNo;
            Buffer."Damages Reported" := Roster.DamagesReported;
            Buffer.Insert();
        end;
        Roster.Close();
    end;

    procedure FillPeriodRoster(FromDate: Date; ToDate: Date; var Buffer: Record "CGR Damage Roster Buffer" temporary)
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        Roster: Query "CGR Vehicle Damage Roster";
    begin
        Buffer.Reset();
        Buffer.DeleteAll();
        Roster.SetRange(ReportedOnFilter, FromDate, ToDate);
        Roster.Open();
        while Roster.Read() do begin
            Buffer.Init();
            Buffer."Vehicle No." := Roster.VehicleNo;
            Buffer."Damages Reported" := Roster.DamagesReported;
            Buffer.Insert();
        end;
        Roster.Close();

        // Vehicles without any damage entry get a zero row.
        if Vehicle.FindSet() then
            repeat
                DamageEntry.SetRange("Vehicle No.", Vehicle."No.");
                if DamageEntry.IsEmpty() then begin
                    Buffer.Init();
                    Buffer."Vehicle No." := Vehicle."No.";
                    Buffer."Damages Reported" := 0;
                    Buffer.Insert();
                end;
            until Vehicle.Next() = 0;
    end;
}
