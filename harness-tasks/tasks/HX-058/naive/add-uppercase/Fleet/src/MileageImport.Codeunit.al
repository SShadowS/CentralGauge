codeunit 70115 "CGR Mileage Import"
{
    procedure ImportMileage(Readings: List of [Text]): Integer
    var
        Vehicle: Record "CGR Vehicle";
        Latest: Dictionary of [Text, Integer];
        Reading: Text;
        Plate: Text;
        KmText: Text;
        Km: Integer;
        SepPos: Integer;
        Updated: Integer;
    begin
        foreach Reading in Readings do begin
            SepPos := StrPos(Reading, ';');
            if SepPos > 0 then begin
                Plate := CopyStr(Reading, 1, SepPos - 1);
                KmText := CopyStr(Reading, SepPos + 1);
                if Evaluate(Km, KmText) then
                    Latest.Add(UpperCase(Plate), Km);
            end;
        end;

        if Vehicle.FindSet() then
            repeat
                if Latest.Get(Vehicle."No.", Km) then
                    if Km > Vehicle.Mileage then begin
                        Vehicle.Mileage := Km;
                        Vehicle.Modify(true);
                        Updated += 1;
                    end;
            until Vehicle.Next() = 0;
        exit(Updated);
    end;
}
