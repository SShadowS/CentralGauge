codeunit 70210 "CG Validation Engine"
{
    Access = Public;

    procedure CreateValidationError(ErrorCode: Enum "CG Validation Error"; FieldName: Text; ErrorMessage: Text): ErrorInfo
    var
        ErrInfo: ErrorInfo;
        Dimensions: Dictionary of [Text, Text];
    begin
        ErrInfo := ErrorInfo.Create(ErrorMessage, IsCollectingErrors());

        Dimensions.Add('ErrorCode', Format(ErrorCode.AsInteger()));
        Dimensions.Add('FieldName', FieldName);
        ErrInfo.CustomDimensions(Dimensions);

        exit(ErrInfo);
    end;

    procedure GetErrorCode(ErrInfo: ErrorInfo): Enum "CG Validation Error"
    var
        Dimensions: Dictionary of [Text, Text];
        ErrorCodeText: Text;
        ErrorCodeValue: Integer;
    begin
        Dimensions := ErrInfo.CustomDimensions();

        if not Dimensions.Get('ErrorCode', ErrorCodeText) then
            exit(Enum::"CG Validation Error"::None);

        if not Evaluate(ErrorCodeValue, ErrorCodeText) then
            exit(Enum::"CG Validation Error"::None);

        exit(Enum::"CG Validation Error".FromInteger(ErrorCodeValue));
    end;

    procedure ValidateNotEmpty(Value: Text; FieldName: Text)
    var
        EmptyFieldErr: Label 'Field cannot be empty';
    begin
        if Value = '' then
            Error(CreateValidationError(Enum::"CG Validation Error"::EmptyField, FieldName, EmptyFieldErr));
    end;

    procedure ValidateInRange(Value: Decimal; MinValue: Decimal; MaxValue: Decimal; FieldName: Text)
    var
        OutOfRangeErr: Label 'Value must be between %1 and %2', Comment = '%1 = minimum value, %2 = maximum value';
    begin
        if (Value < MinValue) or (Value > MaxValue) then
            Error(CreateValidationError(Enum::"CG Validation Error"::OutOfRange, FieldName, StrSubstNo(OutOfRangeErr, MinValue, MaxValue)));
    end;
}
