enum 70450 "CG X080 Carrier Status"
{
    Extensible = true;
    Caption = 'CG X080 Carrier Status';

    value(0; Unknown)
    {
        Caption = 'Unknown';
    }
    value(10; Registered)
    {
        Caption = 'Registered';
    }
    value(20; "In Transit")
    {
        Caption = 'In transit';
    }
    value(30; Delivered)
    {
        Caption = 'Delivered';
    }
}
