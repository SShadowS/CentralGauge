table 70541 "CG X089 Journal Line"
{
    Caption = 'CG X089 Journal Line';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
            DataClassification = SystemMetadata;
            AutoIncrement = true;
        }
        field(2; "Template Name"; Code[10])
        {
            Caption = 'Template Name';
            DataClassification = CustomerContent;
        }
        field(3; "Batch Name"; Code[10])
        {
            Caption = 'Batch Name';
            DataClassification = CustomerContent;
        }
        field(4; "Item No."; Code[20])
        {
            Caption = 'Item No.';
            DataClassification = CustomerContent;
            TableRelation = "CG X089 Item"."No.";
        }
        field(5; Quantity; Decimal)
        {
            Caption = 'Quantity';
            DataClassification = CustomerContent;
        }
        field(6; "Unit Amount"; Decimal)
        {
            Caption = 'Unit Amount';
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
        key(Batch; "Template Name", "Batch Name")
        {
        }
    }
}
