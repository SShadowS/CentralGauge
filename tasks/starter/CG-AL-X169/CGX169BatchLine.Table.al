table 71533 "CG X169 Batch Line"
{
    DataClassification = CustomerContent;
    Caption = 'CG X169 Batch Line';

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
        field(3; "Item No."; Code[20])
        {
            Caption = 'Item No.';
            DataClassification = CustomerContent;
        }
        field(4; Quantity; Decimal)
        {
            Caption = 'Quantity';
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
