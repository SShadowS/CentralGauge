table 70490 "CG X084 Ledger Entry"
{
    Caption = 'CG X084 Ledger Entry';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
            DataClassification = SystemMetadata;
        }
        field(2; "Document No."; Code[20])
        {
            Caption = 'Document No.';
            DataClassification = CustomerContent;
        }
        field(3; "Posting Date"; Date)
        {
            Caption = 'Posting Date';
            DataClassification = CustomerContent;
        }
        field(4; "Original Amount"; Decimal)
        {
            Caption = 'Original Amount';
            DataClassification = CustomerContent;
        }
        field(10; "Remaining Amount"; Decimal)
        {
            Caption = 'Remaining Amount';
            FieldClass = FlowField;
            CalcFormula = sum("CG X084 Entry Detail".Amount where("Entry No." = field("Entry No.")));
            Editable = false;
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
        key(DocNo; "Document No.")
        {
        }
    }
}
