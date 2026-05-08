table 69280 "CG H028 Sample"
{
    Caption = 'CG H028 Sample';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Code"; Code[20])
        {
            Caption = 'Code';
            NotBlank = true;
        }
        field(10; "Sale Date"; Date)
        {
            Caption = 'Sale Date';
        }
        field(20; "Amount"; Decimal)
        {
            Caption = 'Amount';
        }
        field(30; "Region"; Code[10])
        {
            Caption = 'Region';
        }
    }

    keys
    {
        key(PK; "Code")
        {
            Clustered = true;
        }
    }
}
