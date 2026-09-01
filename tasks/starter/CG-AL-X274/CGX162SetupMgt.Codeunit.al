codeunit 71463 "CG X162 Setup Mgt"
{
    procedure SetMeterReading(ForCompany: Text[30]; MeterNo: Code[10]; Qty: Decimal)
    var
        MeterReading: Record "CG X162 Meter Reading";
        Found: Boolean;
    begin
        MeterReading.ChangeCompany(ForCompany);
        Found := MeterReading.Get(MeterNo);
        if not Found then begin
            MeterReading.Init();
            MeterReading."Meter No." := MeterNo;
        end;
        MeterReading.Quantity := Qty;
        if Found then
            MeterReading.Modify()
        else
            MeterReading.Insert();
    end;

    procedure GetMeterReading(ForCompany: Text[30]; MeterNo: Code[10]): Decimal
    var
        MeterReading: Record "CG X162 Meter Reading";
    begin
        MeterReading.ChangeCompany(ForCompany);
        if MeterReading.Get(MeterNo) then
            exit(MeterReading.Quantity);
        exit(0);
    end;
}
