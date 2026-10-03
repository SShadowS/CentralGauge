codeunit 70012 "CGR Export Format"
{
    procedure FormatAmount(Amount: Decimal): Text
    begin
        exit(Format(Amount, 0, '<Precision,2:2><Standard Format,0>'));
    end;

    procedure FormatDate(Value: Date): Text
    begin
        exit(Format(Value, 0, 9));
    end;
}
