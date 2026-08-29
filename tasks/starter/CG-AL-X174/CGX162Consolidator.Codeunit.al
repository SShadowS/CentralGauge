codeunit 71462 "CG X162 Consolidator"
{
    procedure CollectReadings()
    var
        Company: Record Company;
        MeterReading: Record "CG X162 Meter Reading";
        CollectedReading: Record "CG X162 Collected Reading";
    begin
        if Company.FindSet() then
            repeat
                MeterReading.ChangeCompany(Company.Name);
                if MeterReading.FindSet() then
                    repeat
                        if CollectedReading.Get(Company.Name, MeterReading."Meter No.") then begin
                            CollectedReading.Quantity := MeterReading.Quantity;
                            CollectedReading.Modify();
                        end else begin
                            CollectedReading.Init();
                            CollectedReading."Source Company" := Company.Name;
                            CollectedReading."Meter No." := MeterReading."Meter No.";
                            CollectedReading.Quantity := MeterReading.Quantity;
                            CollectedReading.Insert();
                        end;
                    until MeterReading.Next() = 0;
            until Company.Next() = 0;
    end;
}
