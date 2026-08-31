codeunit 70570 "CG X092 Wire Format"
{
    procedure ToWireDecimal(Value: Decimal): Text
    begin
        exit(Format(Value));
    end;

    procedure ToWireDate(Value: Date): Text
    begin
        exit(Format(Value, 0, 9));
    end;

    procedure FromWireDecimal(WireText: Text; var Value: Decimal): Boolean
    begin
        exit(Evaluate(Value, WireText, 9));
    end;

    procedure FromWireDate(WireText: Text; var Value: Date): Boolean
    begin
        exit(Evaluate(Value, WireText, 9));
    end;
}
