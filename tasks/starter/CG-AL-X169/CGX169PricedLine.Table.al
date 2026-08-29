table 71534 "CG X169 Priced Line"
{
    DataClassification = CustomerContent;
    Caption = 'CG X169 Priced Line';

    fields
    {
        field(1; "Batch No."; Code[20])
        {
            Caption = 'Batch No.';
            DataClassification = CustomerContent;
        }
        field(2; "Line No."; Integer)
        {
            Caption = 'Line No.';
            DataClassification = CustomerContent;
        }
        field(3; "Unit Price"; Decimal)
        {
            Caption = 'Unit Price';
            DataClassification = CustomerContent;
        }
        field(4; "Line Amount"; Decimal)
        {
            Caption = 'Line Amount';
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "Batch No.", "Line No.")
        {
            Clustered = true;
        }
    }
}
