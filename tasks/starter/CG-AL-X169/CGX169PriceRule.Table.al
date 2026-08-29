table 71532 "CG X169 Price Rule"
{
    DataClassification = CustomerContent;
    Caption = 'CG X169 Price Rule';

    fields
    {
        field(1; "Price Group"; Code[20])
        {
            Caption = 'Price Group';
            DataClassification = CustomerContent;
        }
        field(2; "Markup Pct"; Decimal)
        {
            Caption = 'Markup Pct';
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "Price Group")
        {
            Clustered = true;
        }
    }
}
