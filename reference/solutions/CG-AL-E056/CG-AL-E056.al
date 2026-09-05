codeunit 70056 "CG Simple ToText"
{
    Access = Public;

    procedure BigIntegerToText(Value: BigInteger): Text
    begin
        exit(Format(Value));
    end;

    procedure ByteToText(Value: Byte): Text
    var
        IntValue: Integer;
    begin
        IntValue := Value;
        exit(Format(IntValue));
    end;

    procedure GuidToText(Value: Guid): Text
    begin
        exit(Format(Value));
    end;

    procedure VersionToText(Value: Version): Text
    begin
        exit(Format(Value));
    end;

    procedure DateTimeToText(Value: DateTime): Text
    begin
        exit(Format(Value));
    end;

    procedure DurationToText(Value: Duration): Text
    begin
        exit(Format(Value));
    end;

    procedure TimeToText(Value: Time): Text
    begin
        exit(Format(Value));
    end;

    procedure DateTimeToInvariantText(Value: DateTime): Text
    begin
        exit(Format(Value, 0, 9));
    end;

    procedure DurationToInvariantText(Value: Duration): Text
    begin
        exit(Format(Value, 0, 9));
    end;

    procedure TimeToInvariantText(Value: Time): Text
    begin
        exit(Format(Value, 0, 9));
    end;
}