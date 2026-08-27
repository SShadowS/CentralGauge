enum 70211 "CG Validation Error"
{
    Extensible = true;

    value(0; None)
    {
        Caption = 'None';
    }
    value(1; EmptyField)
    {
        Caption = 'Empty Field';
    }
    value(2; InvalidFormat)
    {
        Caption = 'Invalid Format';
    }
    value(3; OutOfRange)
    {
        Caption = 'Out of Range';
    }
    value(4; DuplicateValue)
    {
        Caption = 'Duplicate Value';
    }
}
